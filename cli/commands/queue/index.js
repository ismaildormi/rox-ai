// ROX AI — cli/commands/queue/index.js
const { makeGroup } = require('../../lib/group');

module.exports = makeGroup({
  name: 'queue',
  description: 'BullMQ image/video generation queues',
  defaultSubcommand: 'status',
  subcommands: {
    status: { handler: require('./status'), summary: 'Job counts per queue (waiting/active/completed/failed/delayed)' },
    clear: { handler: require('./clear'), summary: 'Remove jobs in a given state (default: failed) — needs --yes' },
    restart: { handler: require('./restart'), summary: 'Pause + resume both queues (not the same as restarting rox-worker)' },
  },
});
