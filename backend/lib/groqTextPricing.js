'use strict';

const limits = require('../config/groq-text-pricing.verified.v1.json');
const { resolveCostQuote } = require('./costRegistry');

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

function estimateGroqTextProviderUpperBound({
  model,
  inputTokens,
  outputTokens,
  serviceTier = 'on_demand',
  toolsUsed = false
} = {}, {
  now = Date.now(),
  env = process.env,
  catalog = limits
} = {}) {
  if (!catalog || catalog.provider !== 'groq' || catalog.serviceTier !== 'on_demand' ||
      catalog.authoritativeCostRegistry !== 'cost-registry.v1.json' || !catalog.models) {
    fail('invalid_pricing_catalog');
  }

  if (serviceTier !== 'on_demand' || toolsUsed !== false) {
    fail('unsupported_pricing_scope');
  }

  if (typeof model !== 'string' || !Object.prototype.hasOwnProperty.call(catalog.models, model)) {
    fail('unknown_priced_model');
  }

  const definition = catalog.models[model];
  const input = nonnegativeInteger(inputTokens, 'input_tokens');
  const output = nonnegativeInteger(outputTokens, 'output_tokens');
  const maxContext = nonnegativeInteger(definition.maxContextTokens, 'context_limit');
  const maxOutput = nonnegativeInteger(definition.maxOutputTokens, 'output_limit');

  if (maxContext === 0n || maxOutput === 0n || output > maxOutput || input + output > maxContext) {
    fail('model_token_limit_exceeded');
  }

  const quote = resolveCostQuote({
    provider: 'groq',
    modelToolId: model,
    capability: 'chat',
    operationType: 'text_generation'
  }, {
    inputUnits: input.toString(),
    outputUnits: output.toString()
  }, { now, env });

  return Object.freeze({
    pricingVersion: quote.pricingVersion,
    costEntryId: quote.costEntryId,
    reviewBefore: quote.reviewBefore,
    provider: 'groq',
    model,
    inputTokens: input.toString(),
    outputTokens: output.toString(),
    providerCostUpperBoundMicroUsd: quote.providerCostMicroUsd,
    kind: 'authoritative_registry_text_rate_upper_bound',
    customerCreditQuoteReady: false,
    accountActualCostVerified: false
  });
}

module.exports = { estimateGroqTextProviderUpperBound };
