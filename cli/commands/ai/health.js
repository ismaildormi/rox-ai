// ROX AI — cli/commands/ai/health.js
//
// Reads the SAME circuit breaker state aiRouter.js checks before every
// request (lib/modelHealth.js -> circuit_check RPC, 07_model_health.sql)
// for every model currently in ROUTES. This needs Redis + Supabase, so
// unlike `rox ai providers`/`rox ai models` it can genuinely have
// nothing to report yet on a fresh install — that's reported clearly,
// not silently skipped.

const { log, loadEnv } = require('../../lib/util');
const { loadAiRouter, loadModelHealth } = require('../../lib/aiBackend');

module.exports = async function health() {
  log.step('ROX AI — model circuit health');
  loadEnv();

  const routerResult = loadAiRouter();
  if (!routerResult.ok) {
    log.err(`Could not load aiRouter.js: ${routerResult.error.message}`);
    process.exitCode = 1;
    return;
  }
  const modelHealthResult = loadModelHealth();
  if (!modelHealthResult.ok) {
    log.err(`Could not load lib/modelHealth.js: ${modelHealthResult.error.message}`);
    process.exitCode = 1;
    return;
  }

  const { ROUTES } = routerResult.module;
  const { canRoute } = modelHealthResult.module;

  const models = [...new Set(Object.values(ROUTES).flat().map((r) => r.model))];
  let anyOpen = false;

  for (const model of models) {
    try {
      const { allowed, isProbe } = await canRoute(model);
      if (allowed && !isProbe) {
        log.ok(`${model}: closed (healthy)`);
      } else if (allowed && isProbe) {
        log.warn(`${model}: half-open (probing after a prior failure)`);
      } else {
        anyOpen = true;
        log.err(`${model}: OPEN (circuit breaker is skipping this model)`);
      }
    } catch (err) {
      log.warn(`${model}: could not check (${err.message}) — is SUPABASE_URL/REDIS_URL set in backend/.env?`);
    }
  }

  console.log('');
  if (anyOpen) {
    log.err('One or more models have an open circuit — aiRouter is automatically skipping them and falling back.');
    process.exitCode = 1;
  } else {
    log.ok('No open circuits.');
  }
};
