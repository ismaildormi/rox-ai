'use strict';

const published = require('../config/groq-text-pricing.verified.v1.json');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function nonnegativeInteger(value, field) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) fail('invalid_' + field);
    return BigInt(value);
  }
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 20) {
    return BigInt(value);
  }
  fail('invalid_' + field);
}

function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

// Pure arithmetic: no provider, wallet, network or environment access.
// For a reservation use a SERVER-VERIFIED input-token upper bound and the
// full completion-token cap (including reasoning), not a client token count.
// No discount is assumed for cache hits or an unverified account free tier.
function estimateGroqTextProviderUpperBound({
  model,
  inputTokens,
  outputTokens,
  serviceTier = 'on_demand',
  toolsUsed = false
} = {}, { now = Date.now(), catalog = published } = {}) {
  if (!catalog || typeof catalog.version !== 'string' || !catalog.version.trim() ||
      catalog.provider !== 'groq' || catalog.currency !== 'USD' ||
      catalog.unitScale !== '1000000' || catalog.serviceTier !== 'on_demand') {
    fail('invalid_pricing_catalog');
  }
  const checkedAt = Date.parse(catalog.verifiedAt);
  const reviewBefore = Date.parse(catalog.reviewBefore);
  if (!Number.isFinite(now) || !Number.isFinite(checkedAt) ||
      !Number.isFinite(reviewBefore) || reviewBefore <= checkedAt ||
      now < checkedAt || now >= reviewBefore) {
    fail('pricing_review_required');
  }
  if (serviceTier !== 'on_demand' || toolsUsed !== false) {
    fail('unsupported_pricing_scope');
  }
  if (typeof model !== 'string' || !catalog.models ||
      !Object.prototype.hasOwnProperty.call(catalog.models, model)) {
    fail('unknown_priced_model');
  }
  const entry = catalog.models[model];
  const input = nonnegativeInteger(inputTokens, 'input_tokens');
  const output = nonnegativeInteger(outputTokens, 'output_tokens');
  const maxContext = nonnegativeInteger(entry.maxContextTokens, 'context_limit');
  const maxOutput = nonnegativeInteger(entry.maxOutputTokens, 'output_limit');
  const inputRate = nonnegativeInteger(entry.inputPriceMicroUsd, 'input_price');
  const outputRate = nonnegativeInteger(entry.outputPriceMicroUsd, 'output_price');
  if (inputRate === 0n || outputRate === 0n) fail('unverified_zero_price');
  if (maxContext === 0n || maxOutput === 0n ||
      output > maxOutput || input + output > maxContext) {
    fail('model_token_limit_exceeded');
  }
  // One rounding operation for the combined cost avoids per-token rounding.
  const cost = ceilDiv(input * inputRate + output * outputRate, 1000000n);
  return Object.freeze({
    pricingVersion: catalog.version,
    provider: 'groq',
    model,
    inputTokens: input.toString(),
    outputTokens: output.toString(),
    providerCostUpperBoundMicroUsd: cost.toString(),
    kind: 'published_uncached_text_rate_upper_bound',
    customerCreditQuoteReady: false,
    accountActualCostVerified: false
  });
}

module.exports = { estimateGroqTextProviderUpperBound };
