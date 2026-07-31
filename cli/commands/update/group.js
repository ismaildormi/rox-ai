// ROX AI — cli/commands/update/group.js
//
// `rox update` (no args) still runs the full update exactly as before
// (git pull -> npm install -> migrations -> pm2 reload) — that behavior
// is untouched, just moved from update.js to update/index.js. `rox
// update models`/`rox update providers` are narrower, faster refreshes
// that don't touch pm2 or git at all.
//
// `rox update plugins` is intentionally NOT registered here yet:
// backend/src/modules/plugins/index.js's installPlugin() still throws
// `not_implemented` on purpose (no sandboxing/execution model has been
// designed — see ARCHITECTURE.md and ROADMAP.md Phase 2). Adding a CLI
// command ahead of that would be exactly the kind of placeholder this
// project's rule against fake functionality rules out.

const { makeGroup } = require('../../lib/group');

module.exports = makeGroup({
  name: 'update',
  description: 'update code/deps/schema, or just AI models/providers',
  defaultSubcommand: 'full',
  subcommands: {
    full: { handler: require('./index'), summary: '(default) git pull, npm install, run migrations, zero-downtime reload' },
    models: { handler: require('./models'), summary: 'Refresh model pricing checks + verify routed models still exist upstream' },
    providers: { handler: require('./providers'), summary: 'Reload .env, recheck provider credentials, probe live reachability' },
  },
});
