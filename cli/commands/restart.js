// ROX AI — cli/commands/restart.js
const { log, pm2 } = require('../lib/util');

module.exports = function restart() {
  log.step('ROX AI — restart');
  pm2(['reload', 'rox-api', 'rox-worker']);
  log.ok('Reloaded both services.');
};
