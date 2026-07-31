// ROX AI — cli/commands/update.js
//
// Pulls new code (if this is a git checkout), installs any new
// dependencies, applies any new numbered .sql migration, then reloads
// both services with zero downtime (pm2 reload starts the new process
// before killing the old one). Safe to run repeatedly — every step is
// itself idempotent (git pull on a clean tree, npm install, and
// migrate.js all no-op when there's nothing new).

const fs = require('fs');
const path = require('path');
const { ROOT_DIR, BACKEND_DIR, log, run, pm2, pm2Available, loadEnv } = require('../../lib/util');

module.exports = function update() {
  log.step('ROX AI — update');
  loadEnv();

  if (fs.existsSync(path.join(ROOT_DIR, '.git'))) {
    log.step('Pulling latest code…');
    run('git', ['pull', '--ff-only'], { cwd: ROOT_DIR, allowFailure: true });
  } else {
    log.warn('Not a git checkout — skipping git pull. Replace the project files yourself before running `rox update` if you\'re updating from a new release archive.');
  }

  log.step('Installing dependencies…');
  run('npm', ['install']);

  log.step('Applying any new schema migrations…');
  run('node', [path.join(BACKEND_DIR, 'scripts', 'migrate.js')]);

  if (pm2Available()) {
    log.step('Reloading services (zero downtime)…');
    try {
      pm2(['reload', 'ecosystem.config.js']);
    } catch (err) {
      log.warn(`Reload failed (${err.message}) — falling back to \`rox start\`.`);
      require('../start')();
    }
  } else {
    log.warn('pm2 not installed yet — run `rox setup` then `rox start`.');
  }

  log.ok('Update complete. Run `rox health` to confirm.');
};
