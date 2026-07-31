// ROX AI — cli/commands/server/index.js
const { makeGroup } = require('../../lib/group');

module.exports = makeGroup({
  name: 'server',
  description: 'machine + process overview',
  defaultSubcommand: 'info',
  subcommands: {
    info: { handler: require('./info'), summary: 'OS/machine facts + rox-api/rox-worker pm2 status' },
  },
});
