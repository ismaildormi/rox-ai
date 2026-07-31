// ROX AI — cli/commands/ai/models.js
//
// Cross-checks config/models.json (pricing) against aiRouter.js's ROUTES
// (what's actually live) instead of just printing the JSON file. Two
// failure modes this is meant to surface:
//   1. A model is routed (real traffic can reach it) but has no `rates`
//      entry -> lib/modelCosts.js silently falls back to `defaultRate`,
//      which makes margin metrics wrong without any error anywhere.
//   2. A `rates` entry is configured for a model that isn't routed
//      anywhere anymore -> stale pricing, safe to leave but worth
//      knowing about before it's mistaken for "this model is live."

const { log, loadEnv } = require('../../lib/util');
const { loadConfig, loadAiRouter } = require('../../lib/aiBackend');

module.exports = async function models() {
  log.step('ROX AI — models');
  loadEnv();

  const configResult = loadConfig();
  if (!configResult.ok) {
    log.err(`Could not load backend config: ${configResult.error.message}`);
    process.exitCode = 1;
    return;
  }
  const { rates, ratesUnrouted, defaultRate } = configResult.module.models;

  const routerResult = loadAiRouter();
  let routedModels = null;
  if (routerResult.ok) {
    routedModels = new Set(Object.values(routerResult.module.ROUTES).flat().map((r) => r.model));
  } else {
    log.warn(`Routed status could not be determined (aiRouter failed to load: ${routerResult.error.message}).`);
  }

  log.step('Priced models (config/models.json "rates")');
  let missingRateForRoutedModel = false;
  for (const [model, rate] of Object.entries(rates)) {
    const routed = routedModels ? routedModels.has(model) : null;
    const note = routed === null ? '' : routed ? ' — routed (live)' : ' — configured but not currently routed';
    log.ok(`${model}: $${rate.input}/M in, $${rate.output}/M out${note}`);
  }

  if (routedModels) {
    const unpriced = [...routedModels].filter((m) => !(m in rates));
    if (unpriced.length > 0) {
      missingRateForRoutedModel = true;
      console.log('');
      for (const model of unpriced) {
        log.err(`${model} is ROUTED but has no rates entry — falling back to defaultRate ($${defaultRate.input}/M in, $${defaultRate.output}/M out). Add a real rate to config/models.json.`);
      }
    }
  }

  if (ratesUnrouted && Object.keys(ratesUnrouted).length > 0) {
    console.log('');
    log.step('Registered-but-unrouted models (config/models.json "ratesUnrouted")');
    for (const [model, rate] of Object.entries(ratesUnrouted)) {
      log.info(`${model}: $${rate.input}/M in, $${rate.output}/M out — not in any ROUTES chain yet`);
    }
  }

  console.log('');
  if (missingRateForRoutedModel) {
    log.err('One or more routed models are missing pricing. Margin metrics for them are inaccurate.');
    process.exitCode = 1;
  } else {
    log.ok('Every routed model has a configured rate.');
  }
};
