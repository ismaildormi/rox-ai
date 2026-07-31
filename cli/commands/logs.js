// ROX AI — cli/commands/logs.js
const { pm2 } = require('../lib/util');

module.exports = function logs(args) {
  const target = args.find((a) => !a.startsWith('--')) || '';
  const lines = (args.find((a) => a.startsWith('--lines=')) || '--lines=100').split('=')[1];
  pm2(target ? ['logs', target, '--lines', lines] : ['logs', '--lines', lines]);
};
