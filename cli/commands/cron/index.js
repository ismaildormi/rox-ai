// ROX AI — cli/commands/cron/index.js
const { makeGroup } = require('../../lib/group');

module.exports = makeGroup({
  name: 'cron',
  description: 'the three /internal/* scheduled jobs (advisor, disk scan, maintenance)',
  defaultSubcommand: 'status',
  subcommands: {
    status: { handler: require('./status'), summary: 'CRON_SECRET configured? + freshness of each job\'s last persisted output' },
    restart: { handler: require('./restart'), summary: 'Manually run all three jobs now (not a process restart — see --help text)' },
  },
});
