// ROX AI — cli/commands/health.js
//
// Checks, in order: are the two pm2 processes actually online (not
// just "started once and crash-looping"), does the API's own /healthz
// respond, and — bonus, if a direct DB connection is configured — is
// the DB reachable. With `--fix`, attempts the one recovery each
// failure mode actually has: restart a stopped/errored pm2 process,
// or start local Redis if that's what /healthz says is down. Exits
// non-zero on any unresolved failure, so this is safe to point a cron
// job or external monitor at.

const path = require('path');
const { log, capture, pm2, pm2Available, loadEnv, run, commandExists, PM2_BIN, getContext } = require('../lib/util');

function checkPm2Processes(fix) {
  const ctx = getContext();
  if (!pm2Available()) {
    log.err('pm2 is not installed — services are not managed. Run `rox setup`.');
    return false;
  }
  let list;
  try {
    list = JSON.parse(capture(PM2_BIN, ['jlist']));
  } catch (err) {
    log.err(`Could not read pm2 process list: ${err.message}`);
    return false;
  }

  const names = ['rox-api', 'rox-worker'];
  let allOk = true;
  for (const name of names) {
    const proc = list.find((p) => p.name === name);
    if (!proc) {
      log.err(`${name}: not registered with pm2. Run \`rox start\`.`);
      allOk = false;
      continue;
    }
    const status = proc.pm2_env?.status;
    if (status === 'online') {
      log.ok(`${name}: online (restarts: ${proc.pm2_env.restart_time})`);
    } else {
      log.err(`${name}: ${status}`);
      allOk = false;
      if (ctx.dryRun && (fix || ctx.repair)) {
        log.info(`--dry-run: would ${ctx.repair ? 'delete + re-register' : 'restart'} ${name}.`);
      } else if (ctx.repair) {
        log.info(`--repair: deleting and re-registering ${name} from ecosystem.config.js…`);
        pm2(['delete', name], { allowFailure: true });
        pm2(['start', 'ecosystem.config.js', '--only', name], { allowFailure: true });
      } else if (fix) {
        log.info(`Attempting to restart ${name}…`);
        pm2(['restart', name], { allowFailure: true });
      }
    }
  }
  return allOk;
}

async function checkApiHealthz() {
  const port = process.env.PORT || 3001;
  try {
    const res = await fetch(`http://localhost:${port}/healthz`, { signal: AbortSignal.timeout(3000) });
    const body = await res.json();
    if (res.ok) {
      log.ok(`API /healthz: ok (redis=${body.checks.redis}, supabase=${body.checks.supabase}, uptime=${body.uptimeSeconds}s)`);
      return true;
    }
    log.err(`API /healthz: degraded — redis=${body.checks.redis}, supabase=${body.checks.supabase}`);
    return { ok: false, checks: body.checks };
  } catch (err) {
    log.err(`API not responding on http://localhost:${port}/healthz (${err.message})`);
    return false;
  }
}

function tryFixRedis() {
  const ctx = getContext();
  if (!commandExists('docker')) {
    log.warn('Docker not available — cannot auto-fix Redis.');
    return;
  }
  if (ctx.dryRun) {
    log.info('--dry-run: would run `docker start rox-redis` to recover local Redis.');
    return;
  }
  log.info('Attempting to recover local Redis…');
  const started = run('docker', ['start', 'rox-redis'], { allowFailure: true });
  if (started === 0) log.ok('Restarted rox-redis container.');
  else log.warn('Could not auto-start rox-redis — check `docker ps -a` manually.');
}

/**
 * Deliberately lightweight: df totals + threshold check only, no
 * directory walk or category breakdown (that's `rox monitor`/`rox
 * doctor` — this needs to stay fast enough for a cron job). Returns
 * true/false so the overall exit code reflects it, same as every
 * other check here.
 */
async function checkDiskSpace(fix) {
  const path = require('path');
  const { BACKEND_DIR } = require('../lib/util');
  let diskScan, diskMonitor, maintenance;
  try {
    diskScan = require(path.join(BACKEND_DIR, 'lib', 'diskScan'));
    diskMonitor = require(path.join(BACKEND_DIR, 'src', 'modules', 'diskMonitor'));
    maintenance = require(path.join(BACKEND_DIR, 'src', 'modules', 'diskMonitor', 'maintenance'));
  } catch (err) {
    log.warn(`Disk check skipped — could not load diskMonitor module (${err.message}). Run \`rox setup\`.`);
    return true; // don't fail the whole health check over a missing optional module
  }

  const totals = diskScan.getDiskTotals(diskMonitor.ROOT_DIR);
  if (!totals.available) {
    log.warn(`Disk check skipped — \`df\` failed (${totals.reason}).`);
    return true;
  }

  let settings;
  try {
    settings = await diskMonitor.getSettings();
  } catch (err) {
    log.warn(`Disk check: could not read thresholds from DB (${err.message}) — using defaults.`);
    settings = { thresholds: { warning: 75, critical: 90, emergency: 95 } };
  }

  const level = diskMonitor.healthLevelFor(totals.usedPct, settings.thresholds);
  const emoji = diskMonitor.LEVEL_EMOJI[level];
  if (level === 'healthy') {
    log.ok(`Disk space: ${emoji} ${totals.usedPct}% used`);
    return true;
  }

  log.err(`Disk space: ${emoji} ${level.toUpperCase()} — ${totals.usedPct}% used`);
  if (fix && (level === 'critical' || level === 'emergency') && getContext().dryRun) {
    log.info('--dry-run: would run the safe disk cleanup sweep now.');
  } else if (fix && (level === 'critical' || level === 'emergency')) {
    log.info('Running safe disk cleanup (temp/cache/old logs/docker images)…');
    try {
      const results = await maintenance.runSafeSweep('auto');
      const freed = results.reduce((sum, r) => sum + (r.bytes_freed || 0), 0);
      log.ok(`Freed ${diskMonitor.fmtBytes(freed)}. Run \`rox monitor\` for the full breakdown, \`rox optimize\` for anything needing confirmation.`);
    } catch (err) {
      log.err(`Cleanup attempt failed: ${err.message}`);
    }
  } else if (level !== 'healthy') {
    log.info('Run `rox doctor --fix` or `rox optimize` for cleanup, `rox monitor` for the full breakdown.');
  }
  return false;
}

module.exports = async function health(args) {
  const ctx = getContext();
  const fix = args.includes('--fix') || ctx.fix || ctx.repair;
  log.step('ROX AI — health check' + (fix ? (ctx.repair ? ' (repair enabled)' : ' (auto-fix enabled)') : '') + (ctx.dryRun ? ' [dry-run]' : ''));
  loadEnv();

  const pm2Ok = checkPm2Processes(fix);
  const apiResult = await checkApiHealthz();
  const diskOk = await checkDiskSpace(fix);

  if (fix && apiResult && apiResult.checks && apiResult.checks.redis === 'unreachable') {
    tryFixRedis();
  }

  const healthy = pm2Ok && apiResult === true && diskOk;
  console.log('');
  if (healthy) {
    log.ok('All systems healthy.');
  } else {
    log.err('One or more checks failed.' + (fix ? ' Re-run `rox health` to confirm fixes took effect.' : ' Re-run with `rox health --fix` to attempt automatic recovery.'));
  }
  process.exitCode = healthy ? 0 : 1;
};
