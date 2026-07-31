// ROX AI — cli/commands/ai/providers.js
//
// Lists every provider adapter registered in
// backend/src/modules/ai/providers/index.js (the 'ai.providers' registry
// bucket), and reports whether each one is actually usable right now:
// credential present, and — for `local` — whether a base URL is
// configured. This reads the SAME registry aiRouter.js calls through,
// so "registered here" and "registered in production" can never drift
// apart the way a hand-maintained doc list would.

const { log, loadEnv } = require('../../lib/util');
const { loadProviders, loadAiRouter, PROVIDER_ENV_VAR, PROVIDER_BASE_URL_VAR, DEFAULT_LOCAL_BASE_URL } = require('../../lib/aiBackend');

module.exports = async function providers() {
  log.step('ROX AI — providers');
  loadEnv();

  const providersResult = loadProviders();
  if (!providersResult.ok) {
    log.err(`Could not load the providers registry: ${providersResult.error.message}`);
    log.info('Run `rox setup` (needs `npm install` in backend/) then try again.');
    process.exitCode = 1;
    return;
  }

  const list = providersResult.module.listProviders();
  if (list.length === 0) {
    log.warn('No providers are registered.');
    return;
  }

  // Best-effort: know which providers are actually reachable via a live
  // route, so "registered" vs "in use" isn't conflated. Not fatal if
  // aiRouter itself can't load (needs bullmq/ioredis/@supabase/supabase-js
  // installed) — providers can still be listed without it.
  const routerResult = loadAiRouter();
  const routedProviderKeys = routerResult.ok
    ? new Set(Object.values(routerResult.module.ROUTES).flat().map((r) => r.provider))
    : null;

  let allConfigured = true;
  for (const { key, label } of list) {
    const routedNote = routedProviderKeys ? (routedProviderKeys.has(key) ? 'routed' : 'registered only') : 'routed status unknown';

    if (key in PROVIDER_ENV_VAR) {
      const envVar = PROVIDER_ENV_VAR[key];
      const configured = Boolean(process.env[envVar] && process.env[envVar].trim());
      if (configured) {
        log.ok(`${label} (${key}) — ${envVar} set — ${routedNote}`);
      } else {
        allConfigured = allConfigured && routedNote !== 'routed';
        const line = `${label} (${key}) — ${envVar} not set — ${routedNote}`;
        if (routedNote === 'routed') log.err(line);
        else log.warn(line);
      }
    } else if (key in PROVIDER_BASE_URL_VAR) {
      const envVar = PROVIDER_BASE_URL_VAR[key];
      const baseUrl = process.env[envVar] || DEFAULT_LOCAL_BASE_URL;
      const usingDefault = !process.env[envVar];
      log.ok(`${label} (${key}) — base URL ${baseUrl}${usingDefault ? ' (default)' : ''} — ${routedNote}`);
    } else {
      log.info(`${label} (${key}) — custom provider (registered at runtime) — ${routedNote}`);
    }
  }

  if (!routerResult.ok) {
    log.warn(`Routed-status could not be determined (aiRouter failed to load: ${routerResult.error.message}).`);
  }

  console.log('');
  if (allConfigured) log.ok('Every routed provider has its credential configured.');
  else log.err('At least one ROUTED provider is missing its credential — requests through it will fail. Set it in backend/.env.');
  process.exitCode = allConfigured ? 0 : 1;
};
