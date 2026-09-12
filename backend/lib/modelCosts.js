'use strict';

// Pack 014 compatibility shim for router ordering and metrics.
// No price table lives here: every usable price comes from costRegistry.
const {
  registry,
  findCostEntries,
  resolveCostEntry,
  estimateProviderCostMicroUsd
} = require('./costRegistry');

function modelCostError(code, model) {
  const error = new Error(code);
  error.code = code;
  error.model = model;
  return error;
}

function candidateEntries(model, provider) {
  let matches = findCostEntries({
    modelToolId: model,
    operationType: 'text_generation',
    ...(provider ? { provider } : {})
  });

  if (matches.length === 0 && provider) {
    matches = findCostEntries({ modelToolId: model, operationType: 'text_generation' });
  }

  return matches;
}

function resolvedEntries(model, {
  provider = null,
  env = process.env,
  now = Date.now()
} = {}) {
  const output = [];
  for (const entry of candidateEntries(model, provider)) {
    try {
      output.push(resolveCostEntry({
        provider: entry.provider,
        modelToolId: entry.modelToolId,
        capability: entry.capability,
        operationType: entry.operationType
      }, { env, now }));
    } catch (_) {
      // Unverified, blocked, missing, not-yet-effective and expired prices are
      // intentionally not usable by the router.
    }
  }
  return output;
}

function estimateCostMicroUsd(model, usage = {}, options = {}) {
  const entries = resolvedEntries(model, options);
  if (entries.length === 0) throw modelCostError('model_cost_unavailable', model);

  let highest = 0n;
  for (const entry of entries) {
    const cost = BigInt(estimateProviderCostMicroUsd(entry, usage));
    if (cost > highest) highest = cost;
  }
  return highest.toString();
}

function estimateCostUsd(model, usage = {}, options = {}) {
  return Number(estimateCostMicroUsd(model, usage, options)) / 1000000;
}

function costTier(model, options = {}) {
  try {
    return Number(estimateCostMicroUsd(model, {
      input_tokens: 1000000,
      output_tokens: 1000000
    }, options)) / 1000000;
  } catch (_) {
    return Number.POSITIVE_INFINITY;
  }
}

// Retained only so a legacy import does not crash. It is deliberately empty:
// the authoritative rates live in cost-registry.v1.json.
const MODEL_COSTS_USD_PER_MILLION_TOKENS = Object.freeze({});

module.exports = {
  MODEL_COSTS_USD_PER_MILLION_TOKENS,
  estimateCostMicroUsd,
  estimateCostUsd,
  costTier
};
