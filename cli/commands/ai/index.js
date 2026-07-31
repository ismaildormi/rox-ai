// ROX AI — cli/commands/ai/index.js
//
// `rox ai <subcommand>` — everything here reads the SAME modules
// aiRouter.js and server.js use at runtime (src/modules/ai/providers,
// src/core/config, aiRouter.js's ROUTES, lib/modelHealth.js). Nothing
// under cli/commands/ai/ maintains its own copy of provider/model/route
// data, so this can never drift from what production actually does.

const { makeGroup } = require('../../lib/group');

module.exports = makeGroup({
  name: 'ai',
  description: 'providers, models, routing, and circuit health',
  defaultSubcommand: 'status',
  subcommands: {
    status: { handler: require('./status'), summary: 'One-screen summary of providers, models, routing, and planned AI flags' },
    providers: { handler: require('./providers'), summary: 'List registered AI providers and whether each has credentials configured' },
    models: { handler: require('./models'), summary: 'Cross-check config/models.json pricing against what aiRouter actually routes' },
    routing: { handler: require('./routing'), summary: 'Show ROUTES fallback chains and the effective chain for a load/tier scenario' },
    health: { handler: require('./health'), summary: 'Live circuit-breaker status per routed model (needs Redis + Supabase)' },
    advisor: { handler: require('./advisor'), summary: 'View/run the AI Business Advisor daily report, resolve recommendations, record outcomes' },
    forecast: { handler: require('./forecast'), summary: 'Show the forecast section of the latest advisor report' },
    optimize: { handler: require('./optimize'), summary: 'Auto Optimizer: mode, safety rules, recent actions, manual sweep/apply/revert' },
  },
});
