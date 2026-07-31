// ROX AI — backend/lib/diskScan.js
//
// Everything here is a read-only, DB-independent primitive: shells out
// to `df`/`docker`/pings Ollama's own HTTP API, or walks the
// filesystem in pure JS. src/modules/diskMonitor/ is the layer that
// adds persistence (snapshots, settings, history) on top of these —
// kept separate so `rox monitor` can call this directly for a live
// read without needing Supabase reachable at all.
//
// Nothing here throws for an unreachable/missing dependency (no
// Docker, no local Ollama, no configured local-storage dir) — every
// function degrades to a clear { available: false, reason } shape
// instead, since "Docker isn't installed" is a completely normal,
// expected state on many deployments, not an error.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const spawn = require('cross-spawn');

const IS_WINDOWS = process.platform === 'win32';
const WHICH_CMD = IS_WINDOWS ? 'where' : 'which';

/** Is `cmd` on PATH? `command -v` is a POSIX shell builtin with no Windows equivalent — `where`/`which` are the real cross-platform check (same approach as cli/lib/util.js). */
function commandExists(cmd) {
  try {
    const result = spawn.sync(WHICH_CMD, [cmd]);
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Total/used/free for the filesystem containing `targetPath`.
 * Uses fs.statfsSync (built into Node 18.15+, backed by
 * GetDiskFreeSpaceEx on Windows and statvfs on POSIX) instead of
 * shelling out to `df`, which doesn't exist on Windows at all.
 */
function getDiskTotals(targetPath = IS_WINDOWS ? process.cwd().split(path.sep)[0] + path.sep : '/') {
  try {
    if (typeof fs.statfsSync !== 'function') {
      return { available: false, reason: 'statfs_unsupported_node_too_old (need Node >=18.15)' };
    }
    const stats = fs.statfsSync(targetPath);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bfree * stats.bsize;
    const usedBytes = totalBytes - freeBytes;
    const usedPct = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;
    return { available: true, totalBytes, usedBytes, freeBytes, usedPct };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

/**
 * Size in bytes of one path, recursively. Returns 0 (not an error) if
 * the path doesn't exist. Pure JS instead of shelling out to `du`
 * (POSIX-only) — bounded by a file-count budget so a huge tree
 * (node_modules, a big Ollama models dir) can't hang a health check.
 */
function duBytes(targetPath, { maxFiles = 200000 } = {}) {
  if (!fs.existsSync(targetPath)) return 0;
  let total = 0;
  let scanned = 0;
  function walk(dirPath) {
    if (scanned > maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return; // permission denied / gone mid-scan
    }
    for (const entry of entries) {
      if (scanned > maxFiles) return;
      if (entry.isSymbolicLink()) continue; // never follow symlinks — avoids cycles
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        scanned++;
        try { total += fs.statSync(full).size; } catch { /* gone mid-scan */ }
      }
    }
  }
  try {
    const rootStat = fs.statSync(targetPath);
    if (rootStat.isDirectory()) walk(targetPath);
    else total = rootStat.size;
  } catch {
    return 0;
  }
  return total;
}

/**
 * Recursive JS walker for largest directories/files — deliberately not
 * shelling out to `find -printf` (GNU-only, breaks on macOS/BSD).
 * Bounded by maxDepth, maxFiles, and a wall-clock budget so a huge or
 * unexpectedly deep tree can't hang a health check or an admin request.
 */
function walkTree(rootPathInput, { maxDepth = 3, maxFiles = 200000, maxMs = 15000 } = {}) {
  const rootPath = path.resolve(rootPathInput); // absolute, so ancestor-accumulation below is well-defined regardless of how the caller phrased it
  const startedAt = Date.now();
  const dirSizes = new Map(); // path -> bytes (includes all descendants)
  const files = []; // { path, bytes }
  let filesScanned = 0;
  let truncated = false;

  function addToAncestors(dirPath, bytes) {
    let current = dirPath;
    while (true) {
      dirSizes.set(current, (dirSizes.get(current) || 0) + bytes);
      const parent = path.dirname(current);
      if (parent === current || !current.startsWith(rootPath)) break;
      current = parent;
    }
  }

  function walk(dirPath, depth) {
    if (truncated) return;
    if (Date.now() - startedAt > maxMs) { truncated = true; return; }
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return; // permission denied / gone mid-scan — skip, don't crash the whole scan
    }
    for (const entry of entries) {
      if (truncated || filesScanned > maxFiles) { truncated = true; return; }
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dirPath, entry.name);
      if (entry.isSymbolicLink()) continue; // never follow symlinks — avoids cycles entirely
      if (entry.isDirectory()) {
        if (depth < maxDepth) walk(full, depth + 1);
        else {
          // beyond max depth: still count its size via du, just don't recurse further in JS
          const bytes = duBytes(full);
          addToAncestors(dirPath, bytes);
          dirSizes.set(full, bytes);
        }
      } else if (entry.isFile()) {
        filesScanned++;
        let bytes = 0;
        try { bytes = fs.statSync(full).size; } catch { /* gone mid-scan */ }
        files.push({ path: full, bytes });
        addToAncestors(dirPath, bytes);
      }
    }
  }

  if (fs.existsSync(rootPath)) walk(rootPath, 0);
  return { dirSizes, files, truncated };
}

function largestDirs(rootPath, { topN = 15, maxDepth = 3 } = {}) {
  const { dirSizes, truncated } = walkTree(rootPath, { maxDepth });
  const sorted = Array.from(dirSizes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([dirPath, bytes]) => ({ path: dirPath, bytes }));
  return { dirs: sorted, truncated };
}

function largestFiles(rootPath, { topN = 15, maxDepth = 6 } = {}) {
  const { files, truncated } = walkTree(rootPath, { maxDepth });
  const sorted = files.sort((a, b) => b.bytes - a.bytes).slice(0, topN);
  return { files: sorted, truncated };
}

/** Ollama model storage — via its own HTTP API (/api/tags), not filesystem access to ~/.ollama. */
async function ollamaModelsInfo(baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434') {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { available: false, reason: `http_${res.status}` };
    const data = await res.json();
    const models = (data.models || []).map((m) => ({
      name: m.name,
      bytes: m.size || 0,
      modifiedAt: m.modified_at || null,
    }));
    const totalBytes = models.reduce((sum, m) => sum + m.bytes, 0);
    return { available: true, totalBytes, models };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

/** Docker's own accounting — images/containers/volumes/build cache, reclaimable vs total. */
function dockerSystemDf() {
  if (!commandExists('docker')) return { available: false, reason: 'docker_not_installed' };
  try {
    const out = execFileSync('docker', ['system', 'df', '--format', '{{json .}}']).toString('utf8').trim();
    const rows = out.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const parseSize = (s) => {
      // Docker prints sizes like "1.2GB" / "512MB" / "0B" — parse to bytes.
      const match = /^([\d.]+)\s*([KMGT]?B)$/i.exec(String(s || '0B').trim());
      if (!match) return 0;
      const num = parseFloat(match[1]);
      const unit = match[2].toUpperCase();
      const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit] || 1;
      return Math.round(num * mult);
    };
    let totalBytes = 0;
    let reclaimableBytes = 0;
    for (const row of rows) {
      totalBytes += parseSize(row.Size);
      reclaimableBytes += parseSize((row.Reclaimable || '').split(' ')[0]);
    }
    return { available: true, totalBytes, reclaimableBytes, breakdown: rows };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

/** Postgres database size — requires SUPABASE_DB_URL (raw connection) OR the rox_database_size_bytes() RPC via a passed-in supabaseAdmin client. */
async function postgresDatabaseSize(supabaseAdmin) {
  if (!supabaseAdmin) return { available: false, reason: 'no_client' };
  try {
    const { data, error } = await supabaseAdmin.rpc('rox_database_size_bytes');
    if (error) return { available: false, reason: error.message };
    return { available: true, bytes: Number(data) };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

/** Reads an optional directory-backed category from an env var — {available:false} if unset or missing on disk. */
function optionalDirCategory(envVarName) {
  const dirPath = process.env[envVarName];
  if (!dirPath) return { available: false, reason: 'not_configured', envVar: envVarName };
  if (!fs.existsSync(dirPath)) return { available: false, reason: 'configured_but_missing', envVar: envVarName, path: dirPath };
  return { available: true, path: dirPath, bytes: duBytes(dirPath) };
}

module.exports = {
  commandExists,
  getDiskTotals,
  duBytes,
  largestDirs,
  largestFiles,
  ollamaModelsInfo,
  dockerSystemDf,
  postgresDatabaseSize,
  optionalDirCategory,
};
