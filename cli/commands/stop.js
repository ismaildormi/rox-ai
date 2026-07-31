// ROX AI — cli/commands/stop.js
//
// Stops exactly the two ROX AI processes by name — never `pm2
// kill`/`pm2 stop all`, which would also stop any unrelated process
// pm2 happens to be managing on the same machine.

const { log, pm2, pm2Available } = require('../lib/util');

module.exports = function stop() {
  log.step('ROX AI — stop');
  if (!pm2Available()) {
    log.warn('pm2 is not installed — nothing is running under it.');
    return;
  }
  pm2(['stop', 'rox-api', 'rox-worker'], { allowFailure: true });
  log.ok('Stopped rox-api and rox-worker. (`rox start` brings them back.)');
};
