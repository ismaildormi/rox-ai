// ROX AI — cli/commands/start.js
//
// Starts both processes (rox-api, rox-worker) under pm2, which is what
// gives auto-recovery for free: if either crashes, pm2 restarts it
// (see ecosystem.config.js). This also tries to recover the single
// most common reason `start` fails on a fresh machine — Redis not
// running yet — before handing that error to the person.

const path = require('path');
const fs = require('fs');
const { BACKEND_DIR, log, run, pm2, pm2Available, loadEnv, commandExists } = require('../lib/util');

function tryStartLocalRedis() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  if (!(redisUrl.includes('localhost') || redisUrl.includes('127.0.0.1'))) return false;
  if (!commandExists('docker')) return false;

  log.warn('Redis not reachable — attempting automatic recovery (docker start/run rox-redis)…');
  const startExisting = run('docker', ['start', 'rox-redis'], { allowFailure: true });
  if (startExisting === 0) {
    log.ok('Restarted existing rox-redis container.');
    return true;
  }
  const created = run('docker', ['run', '-d', '--name', 'rox-redis', '-p', '6379:6379', '--restart', 'unless-stopped', 'redis:7-alpine'], { allowFailure: true });
  if (created === 0) {
    log.ok('Created and started rox-redis container.');
    return true;
  }
  return false;
}

module.exports = function start() {
  log.step('ROX AI — start');
  loadEnv();

  if (!fs.existsSync(path.join(BACKEND_DIR, '.env'))) {
    log.err('backend/.env is missing. Run `rox setup` first.');
    process.exit(1);
  }
  if (!pm2Available()) {
    log.err('pm2 is not installed. Run `rox setup` first.');
    process.exit(1);
  }

  // startOrRestart / startOrReload requires the ecosystem file every
  // time — this is what makes `rox start` idempotent: safe to run
  // again if a service is already up, or if only one of the two died.
  try {
    pm2(['startOrReload', 'ecosystem.config.js']);
  } catch (err) {
    log.warn(`pm2 reported an issue on first attempt: ${err.message}`);
    tryStartLocalRedis();
    log.info('Retrying…');
    pm2(['startOrReload', 'ecosystem.config.js']);
  }

  try {
    run(path.join(BACKEND_DIR, 'node_modules', '.bin', 'pm2'), ['save'], { allowFailure: true });
  } catch { /* non-fatal */ }

  pm2(['status']);
  log.ok('Started. Check `rox health` in a few seconds once both processes settle.');
};
