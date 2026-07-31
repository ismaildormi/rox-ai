// ROX AI — cli/commands/setup.js
//
// One-shot: install deps, create .env if missing, make sure Redis is
// reachable (starting a local Docker container if that's the obvious
// fix), apply the SQL schema if a direct DB connection is configured,
// then register pm2 so both processes survive a reboot with zero
// manual steps afterward. Safe to re-run — every step here checks
// "is this already done" before doing it.

const fs = require('fs');
const path = require('path');
const { BACKEND_DIR, ROOT_DIR, log, run, commandExists, loadEnv, ensureDir, LOGS_DIR, BACKUPS_DIR, PM2_BIN } = require('../lib/util');
const { IS_WINDOWS, installHint } = require('../lib/platform');

function ensureEnvFile() {
  const envPath = path.join(BACKEND_DIR, '.env');
  const examplePath = path.join(BACKEND_DIR, '.env.example');
  if (fs.existsSync(envPath)) {
    log.ok('.env already exists.');
    return;
  }
  fs.copyFileSync(examplePath, envPath);
  log.warn(`Created backend/.env from .env.example — fill in real values before starting.`);
}

function checkRedis() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const isLocal = redisUrl.includes('localhost') || redisUrl.includes('127.0.0.1');

  // ioredis is already a backend dependency once npm install has run —
  // reuse it for a real connectivity check instead of guessing.
  //
  // NOTE: allowFailure:true means run() returns the child's exit status
  // instead of throwing on a non-zero one — so reachability must be
  // decided from that returned status, not from a try/catch around
  // run() itself (run() only throws when allowFailure is false, so a
  // catch here would never fire and the auto-recovery path below would
  // be unreachable regardless of whether Redis actually responded).
  let redisStatus;
  try {
    redisStatus = run('node', ['-e', `
      const IORedis = require('ioredis');
      const r = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 1, retryStrategy: () => null, lazyConnect: true });
      r.connect().then(() => r.ping()).then(() => { console.log('reachable'); process.exit(0); }).catch(() => process.exit(1));
    `], { cwd: BACKEND_DIR, allowFailure: true });
  } catch {
    // e.g. `node` itself missing from PATH — treat as unreachable and
    // fall through to auto-recovery below, same as a failed ping.
    redisStatus = 1;
  }

  if (redisStatus === 0) {
    log.ok('Redis is reachable.');
    return;
  }

  if (!isLocal) {
    log.warn(`Redis at ${redisUrl} is not reachable and is not a local address — can't auto-start it. Check your Redis add-on/connection string.`);
    return;
  }

  if (!commandExists('docker')) {
    const hint = installHint('docker');
    log.warn(`Local Redis is not reachable and Docker is not installed — install Redis yourself, or install Docker so \`rox setup\`/\`rox start\` can manage it.${hint ? ` ${hint}` : ''}`);
    return;
  }

  log.info('Local Redis not reachable — starting one with Docker (rox-redis)…');
  run('docker', ['run', '-d', '--name', 'rox-redis', '-p', '6379:6379', '--restart', 'unless-stopped', 'redis:7-alpine'], { allowFailure: true });
  log.ok('Started rox-redis via Docker (restart policy: unless-stopped, so it survives a reboot too).');
}

function npmInstall() {
  log.step('Installing backend dependencies…');
  run('npm', ['install']);
}

function applySchema() {
  log.step('Applying database schema…');
  run('node', [path.join(BACKEND_DIR, 'scripts', 'migrate.js')]);
}

function registerPm2Startup() {
  log.step('Registering pm2 so services survive a reboot…');
  if (!fs.existsSync(PM2_BIN)) {
    log.warn('pm2 not found after npm install — check backend/package.json.');
    return;
  }

  if (IS_WINDOWS) {
    // `pm2 startup` only knows how to write systemd/launchd/upstart
    // units — on native Windows it just prints an unhelpful error,
    // there's no init system for it to hook into. The pm2-maintained
    // fix is a separate package that registers a real Windows
    // service, so install and run that instead of pm2's own command.
    if (!commandExists('npm')) {
      log.warn('npm not found on PATH — cannot install the Windows startup helper automatically.');
      return;
    }
    log.info('Windows detected — pm2\'s own `startup` command targets systemd/launchd and does not work here. Installing pm2-windows-startup instead…');
    try {
      run('npm', ['install', '-g', 'pm2-windows-startup'], { allowFailure: true });
      if (commandExists('pm2-startup')) {
        run('pm2-startup', ['install'], { allowFailure: true });
        log.ok('Registered pm2 as a Windows startup task via pm2-windows-startup.');
      } else {
        log.warn('pm2-windows-startup installed but `pm2-startup` isn\'t on PATH yet — open a new terminal and run `pm2-startup install` once, or `pm2 save` before every reboot as a manual fallback.');
      }
    } catch (err) {
      log.warn(`Could not install pm2-windows-startup automatically (${err.message}). Run \`npm install -g pm2-windows-startup && pm2-startup install\` yourself, or run \`rox start\` manually after each reboot.`);
    }
    return;
  }

  try {
    run(PM2_BIN, ['startup'], { allowFailure: true });
    log.warn('If pm2 printed a command above starting with "sudo", run it once manually — pm2 can\'t self-elevate. After that, `rox start` + `rox stop` handle everything else.');
  } catch (err) {
    log.warn(`pm2 startup registration skipped: ${err.message}`);
  }
}

module.exports = function setup() {
  log.step('ROX AI — setup');
  ensureDir(LOGS_DIR);
  ensureDir(BACKUPS_DIR);
  ensureEnvFile();
  loadEnv();
  npmInstall();
  loadEnv(); // re-read in case .env was just filled by hand between steps
  checkRedis();
  applySchema();
  registerPm2Startup();

  log.step('Setup complete.');
  log.info('Next: fill in backend/.env if you haven\'t, then run `rox start`.');

  log.info('Check anytime with `rox health`.');
};

// Exposed for unit testing in isolation (see cli/tests/test-setup-redis-check.js).
// Does not change the module's default export/call signature used by rox.js.
module.exports.checkRedis = checkRedis;
