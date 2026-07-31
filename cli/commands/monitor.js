// ROX AI — cli/commands/monitor.js
//
// Requires backend/src/modules/diskMonitor directly (same host, same
// repo — no HTTP round trip, no admin token needed) rather than
// calling the admin API. This is the same reasoning
// backup.js/migrate.js already use for SUPABASE_DB_URL: the CLI runs
// on the same machine as the backend, so reaching into it directly is
// simpler and one less thing that needs an auth token lying around on
// a server's disk.
//
// `rox monitor` = one full scan, printed nicely.
// `rox monitor --watch [--interval=30]` = repeats until Ctrl+C.
// `rox monitor --settings` = show disk_monitor_settings (thresholds,
//   retention, auto-fix) — same row the dashboard's settings panel reads.
// `rox monitor --set key=value [key2=value2 ...]` = update one or more
//   settings (autoFixEnabled, logsRetentionDays, backupRetentionDays,
//   maxBackupsKept, cacheMaxAgeHours, tempMaxAgeHours,
//   abnormalGrowthPct24h, or thresholds='{"warning":70,...}' as JSON) —
//   calls the exact same diskMonitor.updateSettings() the dashboard's PUT
//   /disk/settings does, so this is the CLI-only equivalent of that panel.

const path = require('path');
const os = require('os');
const { BACKEND_DIR, log, loadEnv } = require('../lib/util');

function loadDiskMonitor() {
  return require(path.join(BACKEND_DIR, 'src', 'modules', 'diskMonitor'));
}

function actorId() {
  return `admin:cli:${os.userInfo().username}`;
}

function printSettings(settings) {
  log.step('Disk monitor settings');
  console.log(`  autoFixEnabled:        ${settings.autoFixEnabled}`);
  console.log(`  logsRetentionDays:     ${settings.logsRetentionDays}`);
  console.log(`  backupRetentionDays:   ${settings.backupRetentionDays}`);
  console.log(`  maxBackupsKept:        ${settings.maxBackupsKept}`);
  console.log(`  cacheMaxAgeHours:      ${settings.cacheMaxAgeHours}`);
  console.log(`  tempMaxAgeHours:       ${settings.tempMaxAgeHours}`);
  console.log(`  abnormalGrowthPct24h:  ${settings.abnormalGrowthPct24h}`);
  console.log(`  thresholds:            ${JSON.stringify(settings.thresholds)}`);
}

/** Coerces a raw `key=value` CLI token into the right JS type for updateSettings()'s patch. */
function coerceSettingValue(key, raw) {
  if (key === 'thresholds') return JSON.parse(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const num = Number(raw);
  return Number.isNaN(num) ? raw : num;
}

function printReport(report) {
  const { LEVEL_EMOJI, fmtBytes } = loadDiskMonitor();
  console.log(`\n${LEVEL_EMOJI[report.healthLevel]}  Disk health: ${report.healthLevel.toUpperCase()} — ${report.totals.usedPct}% used`);
  console.log(`   ${fmtBytes(report.totals.usedBytes)} used / ${fmtBytes(report.totals.totalBytes)} total (${fmtBytes(report.totals.freeBytes)} free)`);

  console.log('\nCategories:');
  for (const [name, cat] of Object.entries(report.categories)) {
    if (!cat || cat.available === false) {
      console.log(`   ${name.padEnd(18)} —  (${cat?.reason || 'unavailable'})`);
      continue;
    }
    const bytes = cat.bytes ?? cat.totalBytes ?? 0;
    console.log(`   ${name.padEnd(18)} ${fmtBytes(bytes)}`);
  }

  if (report.largestDirs?.length) {
    console.log('\nLargest directories:');
    for (const d of report.largestDirs.slice(0, 10)) console.log(`   ${fmtBytes(d.bytes).padEnd(10)} ${d.path}`);
  }
  if (report.largestFiles?.length) {
    console.log('\nLargest files:');
    for (const f of report.largestFiles.slice(0, 10)) console.log(`   ${fmtBytes(f.bytes).padEnd(10)} ${f.path}`);
  }

  if (report.growthFlags?.length) {
    console.log('\n⚠ Abnormal growth:');
    for (const flag of report.growthFlags) console.log(`   - ${flag.message}`);
  }

  if (report.recommendations?.length) {
    console.log('\nRecommendations:');
    for (const rec of report.recommendations) {
      const confirmNote = rec.requiresConfirmation ? ' (requires confirmation — see `rox optimize`)' : '';
      console.log(`   - ${rec.message}${confirmNote}`);
    }
  } else {
    console.log('\nNo recommendations — storage looks healthy.');
  }
}

module.exports = async function monitor(args) {
  loadEnv();
  const diskMonitor = loadDiskMonitor();

  if (args.includes('--settings')) {
    try {
      printSettings(await diskMonitor.getSettings());
    } catch (err) {
      log.err(`Could not load settings: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  const setIdx = args.indexOf('--set');
  if (setIdx !== -1) {
    const pairs = args.slice(setIdx + 1).filter((a) => a.includes('='));
    if (pairs.length === 0) {
      log.err('Usage: rox monitor --set key=value [key2=value2 ...]');
      log.info('Keys: autoFixEnabled, logsRetentionDays, backupRetentionDays, maxBackupsKept, cacheMaxAgeHours, tempMaxAgeHours, abnormalGrowthPct24h, thresholds=\'{"warning":70}\'');
      process.exitCode = 1;
      return;
    }
    const patch = {};
    try {
      for (const pair of pairs) {
        const [key, ...rest] = pair.split('=');
        patch[key] = coerceSettingValue(key, rest.join('='));
      }
    } catch (err) {
      log.err(`Could not parse --set value: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    try {
      const updated = await diskMonitor.updateSettings(patch, actorId());
      log.ok('Settings updated.');
      printSettings(updated);
    } catch (err) {
      log.err(`Update failed: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  const watch = args.includes('--watch');
  const intervalArg = args.find((a) => a.startsWith('--interval='));
  const intervalSec = intervalArg ? Number(intervalArg.split('=')[1]) : 30;

  async function tick() {
    log.step(`ROX AI — monitor (${new Date().toLocaleString()})`);
    try {
      const report = await diskMonitor.getFullReport();
      printReport(report);
    } catch (err) {
      log.err(`Scan failed: ${err.message}`);
    }
  }

  await tick();
  if (watch) {
    log.info(`\nWatching every ${intervalSec}s — Ctrl+C to stop.`);
    setInterval(tick, intervalSec * 1000);
  }
};
