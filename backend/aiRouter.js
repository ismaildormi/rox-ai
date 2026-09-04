// ROX AI â€” AI Router (hardened)
//
// The original router had no memory of model health at all: every
// request walked the full Claude â†’ Qwen â†’ DeepSeek chain from scratch,
// even if Claude had failed the last 500 requests in a row. That wastes
// up to PRIMARY_TIMEOUT_MS (15s) per request on a model everyone already
// knows is down, and nothing was shared across server replicas.
//
// Now each model attempt is gated by a circuit breaker (lib/modelHealth.js,
// backed by 07_model_health.sql) so a known-dead model is skipped
// immediately instead of retried and timed out every single time, and
// latency/outcome/fallback metrics are recorded for observability.

const { canRoute, reportOutcome } = require('./lib/modelHealth');
const { recordFallback, recordModelLatency, recordModelOutcome } = require('./lib/metrics');
const { estimateCostUsd, costTier } = require('./lib/modelCosts');
// Providers (anthropic/openrouter/openai/google/groq/local/custom) are no
// longer called directly from this file â€” see src/modules/ai/providers.
// This is what makes providers interchangeable: adding one, swapping one,
// or pointing a route at a customer's own key/endpoint never touches the
// fallback chain, circuit breaker, or credit logic below.
const providers = require('./src/modules/ai/providers');

const PRIMARY_TIMEOUT_MS = 15000;
// Under 'high' load, don't let the (expensive) primary model hold the
// line for a full 15s before falling back â€” fail toward the cheap
// models faster so a traffic spike doesn't also mean a latency spike.
const HIGH_LOAD_TIMEOUT_MS = 6000;
const CODE_TIMEOUT_MS = Number(process.env.CODE_TIMEOUT_MS || 60000);
const MULTIMODAL_TIMEOUT_MS =
  Number(process.env.MULTIMODAL_TIMEOUT_MS || 120000);

// Applies to EVERY model in the chain (previously only Claude had this
// cap; see callOpenRouter below for why an uncapped model is a cost/DoS
// risk, not just a quality knob).
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 2048);
const CODE_MAX_OUTPUT_TOKENS = Number(process.env.CODE_MAX_OUTPUT_TOKENS || 8192);

const ROUTES = {
  chat: [
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' },
    { provider: 'openrouter', model: 'openrouter/free' }
  ],
  code: [
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' },
    { provider: 'openrouter', model: 'openrouter/free' }
  ]
};

const MULTIMODAL_ROUTE = {
  provider: 'openrouter',
  model:
    process.env.OPENROUTER_MULTIMODAL_MODEL ||
    'google/gemini-2.5-flash'
};

// ZUVYR V1 text routing starts with the two models confirmed on the
// organization's Groq free tier. Chat uses 20B first for speed, while
// Code uses 120B first for stronger generation. The other Groq model
// and the existing OpenRouter free routes remain reliability fallbacks.
//
// getEffectiveChain() preserves load-aware ordering without excluding
// Groq according to the legacy Pro flag. Subscription, unified usage,
// quotas and credit top-ups are enforced upstream from this router.
function getEffectiveChain(feature, loadLevel, isPro = true) {
  const chain = ROUTES[feature] || ROUTES.chat;
  if (feature !== 'chat' || loadLevel !== 'high') return chain;
  return [...chain].sort((a, b) => costTier(a.model) - costTier(b.model));
}

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// callModel no longer knows what a provider IS â€” it just asks the
// registry for one by key. Every route's `provider` field (today:
// 'anthropic' | 'openrouter') is looked up the same way a future
// 'openai' | 'google' | 'groq' | 'local' | custom-per-org key would be.
// Behavior for the two providers already in ROUTES is unchanged: same
// endpoints, same max_tokens cap, same request/response shape â€” this
// only moved the two functions into src/modules/ai/providers/index.js
// as registered adapters instead of local functions.
async function callModel(route, messages, maxOutputTokens = MAX_OUTPUT_TOKENS) {
  return providers.call(route.provider, route.model, messages, { maxOutputTokens });
}

/**
 * Runs the fallback chain for a given feature.
 * @param {string} feature
 * @param {Array} messages
 * @param {{loadLevel?: 'normal'|'elevated'|'high'}} [opts] - from lib/loadGuard.js;
 *        passed in from server.js so this function stays pure (no Redis read here).
 * @returns {Promise<{text: string, model: string, fallback_triggered: boolean,
 *                     usage: object, attempts: Array, cost_usd: number, chain_reordered: boolean}>}
 */
async function routeRequest(feature, messages, opts = {}) {
  const loadLevel = opts.loadLevel || 'normal';
  const isPro = opts.isPro !== false;
  const originalChain = ROUTES[feature] || ROUTES.chat;
  const multimodalTypes =
    new Set([
      'image_url',
      'input_audio',
      'video_url',
      'file'
    ]);
  const hasMultimodalInput = messages.some(message =>
    Array.isArray(message?.content) &&
    message.content.some(
      part => multimodalTypes.has(part?.type)
    )
  );
  const chain = hasMultimodalInput
    ? [MULTIMODAL_ROUTE]
    : getEffectiveChain(feature, loadLevel, isPro);
  const chainReordered = chain[0]?.model !== originalChain[0]?.model;

  const timeoutMs =
    hasMultimodalInput
      ? MULTIMODAL_TIMEOUT_MS
      : feature === 'code'
        ? CODE_TIMEOUT_MS
        : (
            loadLevel === 'high'
              ? HIGH_LOAD_TIMEOUT_MS
              : PRIMARY_TIMEOUT_MS
          );
  const attempts = [];

  for (let i = 0; i < chain.length; i++) {
    const route = chain[i];

    const { allowed } = await canRoute(route.model);
    if (!allowed) {
      attempts.push({ model: route.model, status: 'skipped_circuit_open' });
      continue;
    }

    const startedAt = Date.now();
    try {
      const maxOutputTokens =
        feature === 'code'
          ? CODE_MAX_OUTPUT_TOKENS
          : MAX_OUTPUT_TOKENS;

      const result = await withTimeout(
        callModel(route, messages, maxOutputTokens),
        timeoutMs
      );
      attempts.push({ model: route.model, status: 'success' });

      await reportOutcome(route.model, true);
      recordModelLatency(route.model, Date.now() - startedAt);
      recordModelOutcome(route.model, 'success');

      // A reliability fallback (primary was down/slow) is tracked
      // separately from a load-triggered reorder (primary was skipped
      // on purpose to protect margin) â€” conflating them would make
      // rox_fallback_total look like an outage that wasn't one.
      const isReliabilityFallback = !chainReordered && route.model !== originalChain[0].model;
      if (isReliabilityFallback) recordFallback(feature, originalChain[0].model, route.model);

      return {
        text: result.text,
        model: route.model,
        provider: route.provider,
        fallback_triggered: isReliabilityFallback,
        chain_reordered: chainReordered,
        load_level: loadLevel,
        usage: result.usage,
        cost_usd:
          Number.isFinite(Number(result.usage?.cost))
            ? Number(result.usage.cost)
            : estimateCostUsd(route.model, result.usage),
        attempts
      };
    } catch (err) {
      attempts.push({ model: route.model, status: 'error', message: err.message });

      console.error('[aiRouter] model failed', {
        feature,
        model: route.model,
        message: err?.message || 'Unknown model error',
        status:
          err?.status ||
          err?.statusCode ||
          err?.response?.status ||
          null,
        details:
          err?.details ||
          err?.body ||
          err?.response?.data ||
          null
      });

      await reportOutcome(route.model, false);
      recordModelLatency(route.model, Date.now() - startedAt);
      recordModelOutcome(route.model, 'failure');
      // loop continues to the next model in the chain
    }
  }

  const error = new Error('all_models_failed');
  error.attempts = attempts;
  throw error;
}

module.exports = { routeRequest, ROUTES, MULTIMODAL_ROUTE, getEffectiveChain };



