'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  registry,
  validateRegistry,
  findCostEntry,
  resolveCostEntry,
  resolveCostQuote,
  resolveLegacyGenerationCostEntry
} = require('./lib/costRegistry');
const { quoteGeneration } = require('./lib/dynamicPricing');
const { costTier } = require('./lib/modelCosts');

const now = Date.parse('2026-09-12T00:00:00Z');

validateRegistry(registry);
assert.equal(registry.version, 'pack-014.single-cost-registry.v1');
assert.equal(registry.authoritativeLookup, 'backend/lib/costRegistry.js');

const groq = resolveCostQuote({
  provider: 'groq',
  modelToolId: 'openai/gpt-oss-20b',
  capability: 'chat',
  operationType: 'text_generation'
}, { inputUnits: 2000, outputUnits: 1000 }, { now, env: {} });

assert.equal(groq.providerCostMicroUsd, '450');
assert.equal(groq.verificationStatus, 'verified');
assert.equal(groq.unitType, 'tokens');
assert.throws(
  () => resolveCostEntry({
    provider: 'groq',
    modelToolId: 'openai/gpt-oss-20b',
    capability: 'chat',
    operationType: 'text_generation'
  }, { now: Date.parse('2026-09-15T00:00:00Z'), env: {} }),
  { code: 'cost_entry_expired' }
);

assert.throws(
  () => resolveCostEntry({
    provider: 'missing',
    modelToolId: 'missing',
    capability: 'chat',
    operationType: 'text_generation'
  }, { now }),
  { code: 'unknown_cost_entry' }
);

const fal = resolveLegacyGenerationCostEntry('fal', 'image', {
  now,
  env: { FAL_KEY: 'configured', FAL_IMAGE_COST_USD: '0.025' }
});
assert.equal(fal.fixedOperationPriceMicroUsd, '25000');
assert.equal(fal.resolvedPricingSource, 'environment:FAL_IMAGE_COST_USD');

assert.throws(
  () => resolveLegacyGenerationCostEntry('fal', 'image', {
    now,
    env: { FAL_KEY: 'configured' }
  }),
  { code: 'cost_entry_runtime_price_missing' }
);

const generation = quoteGeneration('image', {
  now,
  env: { FAL_KEY: 'configured', FAL_IMAGE_COST_USD: '0.025' }
});
assert.equal(generation.provider, 'fal');
assert.equal(generation.providerCostMicroUsd, '25000');
assert.equal(generation.pricingVersion, registry.version);

const codeUnits = new Map([
  ['build_job', 'build_jobs'],
  ['sandbox_runtime', 'runtime_seconds'],
  ['preview_runtime', 'preview_seconds'],
  ['preview_egress', 'egress_bytes'],
  ['idle_session', 'idle_session_seconds']
]);

for (const [operationType, unitType] of codeUnits) {
  const entry = findCostEntry({
    provider: 'unassigned',
    modelToolId: 'code-studio-runtime',
    capability: 'code',
    operationType
  });
  assert(entry, 'missing Code Studio cost contract: ' + operationType);
  assert.equal(entry.unitType, unitType);
  assert.equal(entry.enabledState, 'blocked');
  assert.equal(entry.verificationStatus, 'unverified');
  assert.throws(() => resolveCostEntry({
    provider: entry.provider,
    modelToolId: entry.modelToolId,
    capability: entry.capability,
    operationType: entry.operationType
  }, { now }), { code: 'cost_entry_blocked' });
}

const dynamicRaw = fs.readFileSync(path.join(__dirname, 'lib/dynamicPricing.js'), 'utf8');
const modelRaw = fs.readFileSync(path.join(__dirname, 'lib/modelCosts.js'), 'utf8');
const groqRaw = fs.readFileSync(path.join(__dirname, 'lib/groqTextPricing.js'), 'utf8');
const oldGroqCatalog = require('./config/groq-text-pricing.verified.v1.json');

for (const forbidden of ['FAL_IMAGE_COST_USD', 'REPLICATE_IMAGE_COST_USD', 'REPLICATE_VIDEO_COST_USD']) {
  assert(!dynamicRaw.includes(forbidden), 'dynamicPricing still owns provider price source: ' + forbidden);
}
assert(!modelRaw.includes("require('../src/core/config')"));
assert(!modelRaw.includes('models.rates'));
assert(!groqRaw.includes('inputPriceMicroUsd'));
assert(!groqRaw.includes('outputPriceMicroUsd'));
for (const model of Object.values(oldGroqCatalog.models)) {
  assert.equal(model.inputPriceMicroUsd, undefined);
  assert.equal(model.outputPriceMicroUsd, undefined);
}

assert.equal(costTier('openai/gpt-oss-20b', { provider: 'groq', now }), 0.375);
assert.equal(costTier('__unknown__', { now }), Number.POSITIVE_INFINITY);

console.log('PASS: Pack 014 has one authoritative versioned cost lookup, compatibility shims, freshness gates and fail-closed unknown pricing');
console.log('PASS: Code Studio build/runtime/preview/egress/idle cost units are registered and blocked until verified');
console.log('DATABASE / PROVIDER / PAYMENT / NETWORK CALLS: NONE');
