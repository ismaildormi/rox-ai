// ROX AI — lib/modelCosts.js
//
// Turns raw token usage (returned by both callAnthropic and callOpenRouter
// in aiRouter.js) into an estimated USD cost per call. This is what lets
// the rest of the system reason about margin instead of just "credits
// consumed" — two requests can cost the same 1 credit but a wildly
// different real amount depending on which model actually answered.
//
// IMPORTANT: these are STARTING-POINT rates, not fetched live from any
// provider. Provider pricing changes over time and by tier/promo — treat
// this object as a config file to keep in sync with your Anthropic /
// OpenRouter billing dashboards, not a permanent source of truth. Wrong
// numbers here don't affect billing (credits are still what's charged to
// the user) — they only affect how accurate your margin metrics are.

// Rates now live in config/models.json (not inline here) so pricing
// updates and new models are a config edit, not a code edit — see
// src/core/config.js and ARCHITECTURE.md "Configuration strategy".
const { models } = require('../src/core/config');
const MODEL_COSTS_USD_PER_MILLION_TOKENS = models.rates;

// Fail-safe default for any model not listed above: assume the most
// expensive known rate rather than 0, so an unlisted/new model can never
// silently look "free" in the margin metrics.
const DEFAULT_RATE = models.defaultRate;

function rateFor(model) {
  return MODEL_COSTS_USD_PER_MILLION_TOKENS[model] || DEFAULT_RATE;
}

/**
 * @param {string} model
 * @param {object} usage - Anthropic shape {input_tokens, output_tokens} or
 *                          OpenAI/OpenRouter shape {prompt_tokens, completion_tokens}
 * @returns {number} estimated USD cost of this single call
 */
function estimateCostUsd(model, usage = {}) {
  const rate = rateFor(model);
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
  const cost =
    (inputTokens / 1_000_000) * rate.input +
    (outputTokens / 1_000_000) * rate.output;
  return Number(cost.toFixed(6));
}

/**
 * A single comparable number per model, used to sort a fallback chain
 * from cheapest to priciest under load (see aiRouter.js). Just the sum
 * of input+output rates — good enough for ordering, not meant as a
 * precise per-call estimate on its own.
 */
function costTier(model) {
  const rate = rateFor(model);
  return rate.input + rate.output;
}

module.exports = { MODEL_COSTS_USD_PER_MILLION_TOKENS, estimateCostUsd, costTier };
