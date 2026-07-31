// ROX AI — cli/commands/update/models.js
//
// "Update all installed AI models." There's no local model download step
// in this project (that's `local`/self-hosted, a user's own runtime) —
// what actually needs updating is ROX's knowledge of which routed
// model IDs are still valid upstream. This runs the same pricing
// cross-check as `rox ai models`, then — for providers that expose a
// models-list endpoint (OpenRouter, OpenAI, Google) — makes a live
// best-effort call to confirm each routed model ID still exists
// upstream. A provider deprecating/renaming a model is exactly the
// kind of thing that otherwise only surfaces as a confusing runtime
// 404 in production.

const { log, loadEnv } = require('../../lib/util');
const { loadAiRouter } = require('../../lib/aiBackend');
const checkModels = require('../ai/models');

const LIST_MODELS_ENDPOINT = {
  openrouter: { url: 'https://openrouter.ai/api/v1/models', envVar: 'OPENROUTER_API_KEY', extract: (data) => (data.data || []).map((m) => m.id) },
  openai: { url: 'https://api.openai.com/v1/models', envVar: 'OPENAI_API_KEY', extract: (data) => (data.data || []).map((m) => m.id) },
};

async function verifyUpstream(provider, model, envVar) {
  const spec = LIST_MODELS_ENDPOINT[provider];
  if (!spec) return { checked: false };
  const apiKey = process.env[envVar];
  if (!apiKey) return { checked: false, reason: `${envVar} not set` };

  try {
    const res = await fetch(spec.url, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { checked: true, ok: false, reason: `${provider} models list returned ${res.status}` };
    const data = await res.json();
    const ids = spec.extract(data);
    return { checked: true, ok: ids.includes(model), reason: ids.includes(model) ? null : 'not found in current upstream models list' };
  } catch (err) {
    return { checked: true, ok: false, reason: err.message };
  }
}

module.exports = async function updateModels() {
  log.step('ROX AI — update models');
  loadEnv();

  await checkModels();

  const routerResult = loadAiRouter();
  if (!routerResult.ok) {
    log.warn('Skipping live upstream verification (aiRouter.js failed to load).');
    return;
  }

  console.log('');
  log.step('Live upstream verification (OpenRouter / OpenAI routed models)');
  const routes = Object.values(routerResult.module.ROUTES).flat();
  const uniqueRoutes = [...new Map(routes.map((r) => [`${r.provider}:${r.model}`, r])).values()];

  let anyStale = false;
  for (const route of uniqueRoutes) {
    const spec = LIST_MODELS_ENDPOINT[route.provider];
    if (!spec) {
      log.info(`${route.provider} / ${route.model}: no models-list endpoint for this provider — nothing to verify`);
      continue;
    }
    const result = await verifyUpstream(route.provider, route.model, spec.envVar);
    if (!result.checked) {
      log.warn(`${route.provider} / ${route.model}: skipped (${result.reason})`);
    } else if (result.ok) {
      log.ok(`${route.provider} / ${route.model}: confirmed live upstream`);
    } else {
      anyStale = true;
      log.err(`${route.provider} / ${route.model}: ${result.reason}`);
    }
  }

  console.log('');
  if (anyStale) {
    log.err('One or more routed models could not be confirmed upstream — check config/models.json and aiRouter.js ROUTES.');
    process.exitCode = 1;
  } else {
    log.ok('Model check complete.');
  }
};
