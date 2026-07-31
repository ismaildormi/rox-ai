// ROX AI — src/modules/diskMonitor/index.js
//
// Orchestrates lib/diskScan.js's primitives into: a persisted snapshot
// (disk_usage_snapshots), a health level against admin-configured
// thresholds, abnormal-growth detection (diff against the previous
// snapshot), and plain-language recommendations. Called from three
// places that all get the SAME numbers: the admin API
// (src/api/v1/adminRoutes.js), and the CLI (`rox health`/`monitor`/
// `doctor`/`optimize`, which require this module directly rather than
// going over HTTP — see docs/CLI.md).
//
// Maintenance ACTIONS (the actual deletions) live in
// src/modules/diskMonitor/maintenance.js — this file only measures and
// recommends, it never deletes anything itself.

const path = require('path');
const { supabaseAdmin } = require('../../../lib/supabaseAdmin');
const diskMonitorDefaults = require('../../../config/diskMonitor.json');
const scan = require('../../../lib/diskScan');

const SETTINGS_ROW_ID = true;
const ROOT_DIR = path.join(__dirname, '..', '..', '..', '..'); // project root (backend/../)
const BACKEND_DIR = path.join(__dirname, '..', '..', '..');
const LOGS_DIR = path.join(ROOT_DIR, 'logs');
const BACKUPS_DIR = path.join(ROOT_DIR, 'backups');

async function getSettings() {
  const { data, error } = await supabaseAdmin
    .from('disk_monitor_settings')
    .select('*')
    .eq('id', SETTINGS_ROW_ID)
    .single();
  if (error) throw error;
  return {
    thresholds: data.thresholds && Object.keys(data.thresholds).length > 0 ? data.thresholds : diskMonitorDefaults.thresholds,
    autoFixEnabled: data.auto_fix_enabled,
    logsRetentionDays: data.logs_retention_days,
    backupRetentionDays: data.backup_retention_days,
    maxBackupsKept: data.max_backups_kept,
    cacheMaxAgeHours: data.cache_max_age_hours,
    tempMaxAgeHours: data.temp_max_age_hours,
    abnormalGrowthPct24h: Number(data.abnormal_growth_pct_24h),
    updatedBy: data.updated_by,
    updatedAt: data.updated_at,
  };
}

async function updateSettings(patch, adminUserId) {
  const columnMap = {
    thresholds: 'thresholds',
    autoFixEnabled: 'auto_fix_enabled',
    logsRetentionDays: 'logs_retention_days',
    backupRetentionDays: 'backup_retention_days',
    maxBackupsKept: 'max_backups_kept',
    cacheMaxAgeHours: 'cache_max_age_hours',
    tempMaxAgeHours: 'temp_max_age_hours',
    abnormalGrowthPct24h: 'abnormal_growth_pct_24h',
  };
  const update = { updated_by: adminUserId, updated_at: new Date().toISOString() };
  for (const [key, column] of Object.entries(columnMap)) {
    if (patch[key] !== undefined) update[column] = patch[key];
  }
  const { data, error } = await supabaseAdmin
    .from('disk_monitor_settings')
    .update(update)
    .eq('id', SETTINGS_ROW_ID)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Runs every category scan. Categories with no local footprint (uploads/images/videos by default) report {available:false}. */
async function collectCategories() {
  const [ollama, docker, dbSize] = await Promise.all([
    scan.ollamaModelsInfo(),
    Promise.resolve(scan.dockerSystemDf()),
    scan.postgresDatabaseSize(supabaseAdmin),
  ]);

  return {
    ollama,
    docker,
    logs: { available: true, path: LOGS_DIR, bytes: scan.duBytes(LOGS_DIR) },
    backups: { available: true, path: BACKUPS_DIR, bytes: scan.duBytes(BACKUPS_DIR) },
    uploads: scan.optionalDirCategory(diskMonitorDefaults.envVarsByCategory.uploads),
    generatedImages: scan.optionalDirCategory(diskMonitorDefaults.envVarsByCategory.generatedImages),
    generatedVideos: scan.optionalDirCategory(diskMonitorDefaults.envVarsByCategory.generatedVideos),
    cache: scan.optionalDirCategory(diskMonitorDefaults.envVarsByCategory.cache),
    temp: scan.optionalDirCategory(diskMonitorDefaults.envVarsByCategory.temp),
    database: dbSize,
  };
}

function healthLevelFor(usedPct, thresholds) {
  if (usedPct >= thresholds.emergency) return 'emergency';
  if (usedPct >= thresholds.critical) return 'critical';
  if (usedPct >= thresholds.warning) return 'warning';
  return 'healthy';
}

const LEVEL_EMOJI = { healthy: '🟢', warning: '🟡', critical: '🟠', emergency: '🔴' };

/** Full scan + persist. This is what `rox monitor`/`rox health`/the admin API all call. */
async function runScan() {
  const settings = await getSettings();
  const totals = scan.getDiskTotals(ROOT_DIR);
  const categories = await collectCategories();
  const { dirs: largestDirs, truncated: dirsTruncated } = scan.largestDirs(ROOT_DIR, {
    topN: diskMonitorDefaults.scan.defaultTopN,
    maxDepth: diskMonitorDefaults.scan.defaultMaxDepth,
  });
  const { files: largestFiles, truncated: filesTruncated } = scan.largestFiles(ROOT_DIR, {
    topN: diskMonitorDefaults.scan.defaultTopN,
  });

  const usedPct = totals.available ? totals.usedPct : 0;
  const healthLevel = healthLevelFor(usedPct, settings.thresholds);

  const snapshot = {
    capturedAt: new Date().toISOString(),
    totals,
    categories,
    largestDirs,
    largestFiles,
    scanTruncated: dirsTruncated || filesTruncated,
    healthLevel,
    healthEmoji: LEVEL_EMOJI[healthLevel],
  };

  if (totals.available) {
    const { error } = await supabaseAdmin.from('disk_usage_snapshots').insert({
      total_bytes: totals.totalBytes,
      used_bytes: totals.usedBytes,
      free_bytes: totals.freeBytes,
      used_pct: totals.usedPct,
      categories,
      largest_dirs: largestDirs,
      largest_files: largestFiles,
      health_level: healthLevel,
      metadata: { scanTruncated: snapshot.scanTruncated },
    });
    if (error) console.error('[diskMonitor] failed to persist snapshot:', error.message);
  }

  return snapshot;
}

/** Compares the latest snapshot against ~24h ago per-category to flag abnormal growth. */
async function detectAbnormalGrowth() {
  const settings = await getSettings();
  const since = new Date(Date.now() - 25 * 3600000).toISOString(); // 25h window catches "around a day ago" even with irregular scan intervals
  const { data, error } = await supabaseAdmin
    .from('disk_usage_snapshots')
    .select('*')
    .gte('captured_at', since)
    .order('captured_at', { ascending: true })
    .limit(500);
  if (error || !data || data.length < 2) return [];

  const oldest = data[0];
  const newest = data[data.length - 1];
  const flags = [];

  for (const [category, newVal] of Object.entries(newest.categories || {})) {
    if (!newVal || newVal.available === false) continue;
    const oldVal = oldest.categories?.[category];
    if (!oldVal || oldVal.available === false) continue;
    const oldBytes = oldVal.bytes ?? oldVal.totalBytes ?? 0;
    const newBytes = newVal.bytes ?? newVal.totalBytes ?? 0;
    if (oldBytes <= 0) continue;
    const growthPct = ((newBytes - oldBytes) / oldBytes) * 100;
    if (growthPct >= settings.abnormalGrowthPct24h) {
      flags.push({
        category,
        growthPct: Math.round(growthPct * 10) / 10,
        oldBytes,
        newBytes,
        message: `${category} grew ${Math.round(growthPct)}% in the last ~24h (${fmtBytes(oldBytes)} → ${fmtBytes(newBytes)}).`,
      });
    }
  }
  return flags;
}

function fmtBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Plain-language recommendations, in the exact style requested ("Delete unused Ollama models to recover 42 GB."). */
function buildRecommendations(snapshot, growthFlags) {
  const recs = [];
  const c = snapshot.categories;

  if (c.ollama?.available && c.ollama.totalBytes > 0) {
    recs.push({
      category: 'ollama',
      message: `Ollama models are using ${fmtBytes(c.ollama.totalBytes)} across ${c.ollama.models.length} model(s). Review for ones no longer in use.`,
      potentialBytes: c.ollama.totalBytes,
      actionType: 'remove_ollama_model',
      requiresConfirmation: true,
    });
  }
  if (c.docker?.available && c.docker.reclaimableBytes > 0) {
    recs.push({
      category: 'docker',
      message: `Docker has ${fmtBytes(c.docker.reclaimableBytes)} of reclaimable images/build cache.`,
      potentialBytes: c.docker.reclaimableBytes,
      actionType: 'docker_prune_images',
      requiresConfirmation: false,
    });
  }
  if (c.backups?.bytes > 0) {
    recs.push({
      category: 'backups',
      message: `Old backups are using ${fmtBytes(c.backups.bytes)}.`,
      potentialBytes: c.backups.bytes,
      actionType: 'delete_old_backups',
      requiresConfirmation: false,
    });
  }
  if (c.logs?.bytes > 0) {
    recs.push({
      category: 'logs',
      message: `Logs are consuming ${fmtBytes(c.logs.bytes)}.`,
      potentialBytes: c.logs.bytes,
      actionType: 'delete_old_logs',
      requiresConfirmation: false,
    });
  }
  if (c.temp?.available && c.temp.bytes > 0) {
    recs.push({
      category: 'temp',
      message: `Temporary files are using ${fmtBytes(c.temp.bytes)} and can be cleared safely.`,
      potentialBytes: c.temp.bytes,
      actionType: 'delete_temp',
      requiresConfirmation: false,
    });
  }
  if (c.cache?.available && c.cache.bytes > 0) {
    recs.push({
      category: 'cache',
      message: `Cache is using ${fmtBytes(c.cache.bytes)}; expired entries can be cleared.`,
      potentialBytes: c.cache.bytes,
      actionType: 'delete_cache',
      requiresConfirmation: false,
    });
  }
  if (c.uploads?.available && c.uploads.bytes > 0) {
    recs.push({
      category: 'uploads',
      message: `User uploads are using ${fmtBytes(c.uploads.bytes)}.`,
      potentialBytes: c.uploads.bytes,
      actionType: 'delete_uploads',
      requiresConfirmation: true,
    });
  }
  for (const [category, envKey] of [['generatedImages', 'generatedImages'], ['generatedVideos', 'generatedVideos']]) {
    const cat = c[envKey];
    if (cat?.available && cat.bytes > 0) {
      recs.push({
        category,
        message: `Generated ${category === 'generatedImages' ? 'images' : 'videos'} are using ${fmtBytes(cat.bytes)}.`,
        potentialBytes: cat.bytes,
        actionType: 'delete_generated_content',
        requiresConfirmation: true,
      });
    }
  }
  for (const flag of growthFlags) {
    recs.push({
      category: flag.category,
      message: `Abnormal growth detected: ${flag.message}`,
      potentialBytes: 0,
      actionType: 'investigate',
      requiresConfirmation: false,
      severity: 'warning',
    });
  }

  return recs.sort((a, b) => (b.potentialBytes || 0) - (a.potentialBytes || 0));
}

async function getFullReport() {
  const [snapshot, growthFlags] = await Promise.all([runScan(), detectAbnormalGrowth()]);
  const recommendations = buildRecommendations(snapshot, growthFlags);
  return { ...snapshot, growthFlags, recommendations };
}

async function getLatestSnapshot() {
  const { data, error } = await supabaseAdmin
    .from('disk_usage_snapshots')
    .select('*')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

module.exports = {
  getSettings,
  updateSettings,
  runScan,
  detectAbnormalGrowth,
  buildRecommendations,
  getFullReport,
  getLatestSnapshot,
  healthLevelFor,
  fmtBytes,
  LEVEL_EMOJI,
  ROOT_DIR,
  LOGS_DIR,
  BACKUPS_DIR,
};
