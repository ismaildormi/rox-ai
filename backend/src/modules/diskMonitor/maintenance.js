// ROX AI — src/modules/diskMonitor/maintenance.js
//
// Every action here is a plain function: (settings) -> { bytesFreed,
// manifest }. runAction() wraps whichever one was requested with the
// SAME log-write regardless of outcome (success or failure), same
// posture as optimizer/index.js's applyAction() — the difference is
// these are mostly NOT reversible (see 14_disk_monitor_schema.sql's
// comment on disk_maintenance_log), so `reversible` in the log is
// honest about that instead of implying an undo button that isn't real.
//
// THE ONE HARD RULE, enforced here (not just in the route layer):
// removeOllamaModel(), deleteUploads-equivalents, and anything hitting
// a category with real user data NEVER run from runAction() directly —
// they only ever run via resolveConfirmation(), which requires a row in
// disk_pending_confirmations already moved to 'confirmed' by an admin.
// There is no code path in this file that deletes a model or user
// content without that row existing first.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { supabaseAdmin } = require('../../../lib/supabaseAdmin');
const scan = require('../../../lib/diskScan');
const diskMonitor = require('./index');

const NEVER_AUTO = new Set(['remove_ollama_model', 'delete_uploads', 'delete_generated_content', 'docker_prune_volumes']);

function listFilesOlderThan(dirPath, maxAgeMs) {
  if (!fs.existsSync(dirPath)) return [];
  const cutoff = Date.now() - maxAgeMs;
  return fs.readdirSync(dirPath)
    .map((name) => path.join(dirPath, name))
    .filter((full) => {
      try { return fs.statSync(full).mtimeMs < cutoff; } catch { return false; }
    });
}

function sizeAndDelete(filePaths) {
  let bytesFreed = 0;
  const manifest = [];
  for (const filePath of filePaths) {
    try {
      const bytes = fs.statSync(filePath).size;
      fs.rmSync(filePath, { recursive: true, force: true });
      bytesFreed += bytes;
      manifest.push({ path: filePath, bytes });
    } catch (err) {
      manifest.push({ path: filePath, error: err.message });
    }
  }
  return { bytesFreed, manifest };
}

// --- Non-destructive-to-user-data actions (may run under auto-fix) --------

function deleteTemp(settings) {
  const dir = process.env.TEMP_DIR;
  if (!dir || !fs.existsSync(dir)) return { bytesFreed: 0, manifest: [], note: 'TEMP_DIR not configured or missing — nothing to clean.' };
  const old = listFilesOlderThan(dir, settings.tempMaxAgeHours * 3600000);
  return sizeAndDelete(old);
}

function deleteCache(settings) {
  const dir = process.env.CACHE_DIR;
  if (!dir || !fs.existsSync(dir)) return { bytesFreed: 0, manifest: [], note: 'CACHE_DIR not configured or missing — nothing to clean.' };
  const old = listFilesOlderThan(dir, settings.cacheMaxAgeHours * 3600000);
  return sizeAndDelete(old);
}

function deleteOldLogs(settings) {
  const old = listFilesOlderThan(diskMonitor.LOGS_DIR, settings.logsRetentionDays * 86400000)
    .filter((f) => !f.endsWith('.gz')); // compressed logs are handled by their own retention below, not double-deleted here
  return sizeAndDelete(old);
}

function compressLogs() {
  // Compress anything in logs/ older than 1 day that isn't already .gz —
  // a non-destructive alternative to deleting: keeps the content, just smaller.
  const dir = diskMonitor.LOGS_DIR;
  if (!fs.existsSync(dir)) return { bytesFreed: 0, manifest: [] };
  const candidates = listFilesOlderThan(dir, 86400000).filter((f) => !f.endsWith('.gz'));
  let bytesFreed = 0;
  const manifest = [];
  for (const filePath of candidates) {
    try {
      const before = fs.statSync(filePath).size;
      const content = fs.readFileSync(filePath);
      fs.writeFileSync(`${filePath}.gz`, zlib.gzipSync(content));
      fs.rmSync(filePath);
      const after = fs.statSync(`${filePath}.gz`).size;
      bytesFreed += before - after;
      manifest.push({ path: filePath, beforeBytes: before, afterBytes: after });
    } catch (err) {
      manifest.push({ path: filePath, error: err.message });
    }
  }
  return { bytesFreed, manifest };
}

function deleteOldBackups(settings) {
  const old = listFilesOlderThan(diskMonitor.BACKUPS_DIR, settings.backupRetentionDays * 86400000)
    .filter((f) => f.endsWith('.tar.gz'));
  return sizeAndDelete(old);
}

function keepLatestBackups(settings) {
  const dir = diskMonitor.BACKUPS_DIR;
  if (!fs.existsSync(dir)) return { bytesFreed: 0, manifest: [] };
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.tar.gz'))
    .map((f) => ({ path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const toDelete = files.slice(settings.maxBackupsKept).map((f) => f.path);
  return sizeAndDelete(toDelete);
}

function dockerPruneImages() {
  if (!scan.commandExists('docker')) return { bytesFreed: 0, manifest: [], note: 'docker not installed' };
  try {
    const before = scan.dockerSystemDf();
    const out = execFileSync('docker', ['image', 'prune', '-af']).toString('utf8');
    const after = scan.dockerSystemDf();
    const bytesFreed = before.available && after.available ? Math.max(0, before.totalBytes - after.totalBytes) : 0;
    return { bytesFreed, manifest: [{ dockerOutput: out.trim() }] };
  } catch (err) {
    return { bytesFreed: 0, manifest: [], error: err.message };
  }
}

// --- Destructive-to-possibly-real-data actions: NEVER auto, always confirmed ---

function dockerPruneVolumes() {
  // Never auto-run: an unnamed/anonymous volume can still be a live
  // Redis or Postgres data directory a human forgot to name — pruning
  // requires the exact same confirm flow as removing an Ollama model.
  if (!scan.commandExists('docker')) return { bytesFreed: 0, manifest: [], note: 'docker not installed' };
  try {
    const out = execFileSync('docker', ['volume', 'prune', '-f']).toString('utf8');
    return { bytesFreed: 0, manifest: [{ dockerOutput: out.trim() }], note: 'bytes freed not measured — see docker output' };
  } catch (err) {
    return { bytesFreed: 0, manifest: [], error: err.message };
  }
}

async function removeOllamaModel(modelName, baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434') {
  const info = await scan.ollamaModelsInfo(baseUrl);
  const model = info.available ? info.models.find((m) => m.name === modelName) : null;
  const res = await fetch(`${baseUrl}/api/delete`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: modelName }),
  });
  if (!res.ok) throw new Error(`ollama_delete_${res.status}`);
  return { bytesFreed: model?.bytes || 0, manifest: [{ model: modelName }] };
}

/**
 * The actual executor behind confirmed 'delete_uploads' /
 * 'delete_generated_content' decisions. Age-based only (never "delete
 * everything in the category") and only ever touches a directory the
 * deployment explicitly configured via env var — there's no default
 * path here, unlike temp/cache/logs, because a missing env var for
 * this category means "this deployment doesn't store this locally,"
 * not "use some guessed default."
 */
function deleteAgedFilesInCategory(envVarName, olderThanDays) {
  const dir = process.env[envVarName];
  if (!dir) return { bytesFreed: 0, manifest: [], note: `${envVarName} is not configured — nothing to delete.` };
  if (!fs.existsSync(dir)) return { bytesFreed: 0, manifest: [], note: `${envVarName} points at a path that doesn't exist.` };
  if (!Number.isFinite(olderThanDays) || olderThanDays < 1) {
    throw Object.assign(new Error('olderThanDays must be a positive number of days — refusing to guess a default for user content.'), { code: 'invalid_target' });
  }
  const old = listFilesOlderThan(dir, olderThanDays * 86400000);
  return sizeAndDelete(old);
}

const ACTIONS = {
  delete_temp: { fn: deleteTemp, destructive: false, reversible: false },
  delete_cache: { fn: deleteCache, destructive: false, reversible: false },
  delete_old_logs: { fn: deleteOldLogs, destructive: false, reversible: false },
  compress_logs: { fn: compressLogs, destructive: false, reversible: false },
  delete_old_backups: { fn: deleteOldBackups, destructive: true, reversible: false },
  keep_latest_backups: { fn: keepLatestBackups, destructive: true, reversible: false },
  docker_prune_images: { fn: dockerPruneImages, destructive: false, reversible: false },
  docker_prune_volumes: { fn: dockerPruneVolumes, destructive: true, reversible: false, neverAuto: true },
};

async function logMaintenance({ actionType, description, triggeredBy, destructive, reversible, bytesFreed, manifest, status, errorMessage }) {
  const { data, error } = await supabaseAdmin
    .from('disk_maintenance_log')
    .insert({
      action_type: actionType,
      description,
      triggered_by: triggeredBy,
      destructive,
      reversible,
      bytes_freed: bytesFreed || 0,
      manifest: manifest || [],
      status,
      error_message: errorMessage || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Runs one non-confirmation-gated action. Throws if the action is in NEVER_AUTO and triggeredBy === 'auto'. */
async function runAction(actionType, triggeredBy, description) {
  const spec = ACTIONS[actionType];
  if (!spec) throw Object.assign(new Error(`Unknown disk maintenance action: ${actionType}`), { code: 'unknown_action' });
  if (triggeredBy === 'auto' && (NEVER_AUTO.has(actionType) || spec.neverAuto)) {
    throw Object.assign(new Error(`"${actionType}" can never run automatically — requires manual admin confirmation.`), { code: 'requires_manual_approval' });
  }

  const settings = await diskMonitor.getSettings();
  try {
    const result = await spec.fn(settings);
    return await logMaintenance({
      actionType,
      description: description || actionType,
      triggeredBy,
      destructive: spec.destructive,
      reversible: spec.reversible,
      bytesFreed: result.bytesFreed,
      manifest: result.manifest,
      status: 'completed',
    });
  } catch (err) {
    await logMaintenance({
      actionType,
      description: description || actionType,
      triggeredBy,
      destructive: spec.destructive,
      reversible: spec.reversible,
      bytesFreed: 0,
      manifest: [],
      status: 'failed',
      errorMessage: err.message,
    });
    throw err;
  }
}

/** Runs every safe, non-destructive action in sequence — what `rox optimize` does by default and what auto-fix mode runs on schedule. */
async function runSafeSweep(triggeredBy) {
  const SAFE_ORDER = ['delete_temp', 'delete_cache', 'delete_old_logs', 'compress_logs', 'docker_prune_images'];
  const results = [];
  for (const actionType of SAFE_ORDER) {
    try {
      results.push(await runAction(actionType, triggeredBy, `Automatic sweep: ${actionType}`));
    } catch (err) {
      results.push({ action_type: actionType, status: 'failed', error_message: err.message });
    }
  }
  return results;
}

// --- Confirmation flow: required for anything touching real data ----------

async function requestConfirmation({ actionType, target, estimatedBytes, reason, requestedBy }) {
  const { data, error } = await supabaseAdmin
    .from('disk_pending_confirmations')
    .insert({ action_type: actionType, target, estimated_bytes: estimatedBytes || 0, reason, requested_by: requestedBy })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function listPendingConfirmations() {
  const { data, error } = await supabaseAdmin
    .from('disk_pending_confirmations')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** The ONLY path that actually deletes an Ollama model, user uploads, or generated content — requires an already-pending confirmation row and an explicit admin decision. */
async function resolveConfirmation(confirmationId, decision, adminUserId) {
  if (!['confirmed', 'rejected'].includes(decision)) {
    throw Object.assign(new Error('decision must be "confirmed" or "rejected"'), { code: 'invalid_decision' });
  }
  const { data: pending, error } = await supabaseAdmin
    .from('disk_pending_confirmations')
    .select('*')
    .eq('id', confirmationId)
    .single();
  if (error) throw error;
  if (pending.status !== 'pending') {
    throw Object.assign(new Error(`This confirmation is already "${pending.status}".`), { code: 'already_resolved' });
  }

  await supabaseAdmin
    .from('disk_pending_confirmations')
    .update({ status: decision, resolved_by: adminUserId, resolved_at: new Date().toISOString() })
    .eq('id', confirmationId);

  if (decision === 'rejected') return { status: 'rejected' };

  if (pending.action_type === 'remove_ollama_model') {
    const result = await removeOllamaModel(pending.target.model);
    return logMaintenance({
      actionType: 'remove_ollama_model',
      description: `Removed Ollama model "${pending.target.model}" (confirmed by admin:${adminUserId})`,
      triggeredBy: `admin:${adminUserId}`,
      destructive: true,
      reversible: false,
      bytesFreed: result.bytesFreed,
      manifest: result.manifest,
      status: 'completed',
    });
  }

  if (pending.action_type === 'docker_prune_volumes') {
    const result = dockerPruneVolumes();
    return logMaintenance({
      actionType: 'docker_prune_volumes',
      description: `Docker volume prune (confirmed by admin:${adminUserId})`,
      triggeredBy: `admin:${adminUserId}`,
      destructive: true,
      reversible: false,
      bytesFreed: result.bytesFreed,
      manifest: result.manifest,
      status: result.error ? 'failed' : 'completed',
      errorMessage: result.error,
    });
  }

  if (pending.action_type === 'delete_uploads') {
    const result = deleteAgedFilesInCategory('UPLOADS_DIR', pending.target.olderThanDays);
    return logMaintenance({
      actionType: 'delete_uploads',
      description: `Deleted uploads older than ${pending.target.olderThanDays} day(s) (confirmed by admin:${adminUserId})`,
      triggeredBy: `admin:${adminUserId}`,
      destructive: true,
      reversible: false,
      bytesFreed: result.bytesFreed,
      manifest: result.manifest,
      status: 'completed',
    });
  }

  if (pending.action_type === 'delete_generated_content') {
    // target.category picks which optional directory: 'generatedImages' -> GENERATED_IMAGES_DIR, 'generatedVideos' -> GENERATED_VIDEOS_DIR.
    const envVarByCategory = { generatedImages: 'GENERATED_IMAGES_DIR', generatedVideos: 'GENERATED_VIDEOS_DIR' };
    const envVarName = envVarByCategory[pending.target.category];
    if (!envVarName) {
      throw Object.assign(new Error(`target.category must be "generatedImages" or "generatedVideos", got "${pending.target.category}".`), { code: 'invalid_target' });
    }
    const result = deleteAgedFilesInCategory(envVarName, pending.target.olderThanDays);
    return logMaintenance({
      actionType: 'delete_generated_content',
      description: `Deleted ${pending.target.category} older than ${pending.target.olderThanDays} day(s) (confirmed by admin:${adminUserId})`,
      triggeredBy: `admin:${adminUserId}`,
      destructive: true,
      reversible: false,
      bytesFreed: result.bytesFreed,
      manifest: result.manifest,
      status: 'completed',
    });
  }

  throw Object.assign(new Error(`No handler wired for confirmed action "${pending.action_type}" yet.`), { code: 'not_implemented' });
}

async function listMaintenanceLog({ limit = 50 } = {}) {
  const { data, error } = await supabaseAdmin
    .from('disk_maintenance_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

module.exports = {
  ACTIONS,
  runAction,
  runSafeSweep,
  requestConfirmation,
  listPendingConfirmations,
  resolveConfirmation,
  listMaintenanceLog,
};
