'use strict';

const assert = require('assert');
const { calculateCharge, ceilDiv } = require('./lib/exactMoney');
const {
  registry,
  validateRegistry,
  resolveCostEntry,
  estimateProviderCostMicroUsd
} = require('./lib/costRegistry');

const policy = {
  creditValueMicroUsd: '1000',
  minimumChargeCredits: '1',
  targetGrossMarginBps: 5000,
  providerCostReserveBps: 1000,
  retryFailureReserveBps: 500,
  currencyChangeReserveBps: 500,
  infrastructureReserveMicroUsd: '2000'
};

assert.strictEqual(ceilDiv(10n, 3n), 4n);
assert.strictEqual(ceilDiv(9n, 3n), 3n);

const charge = calculateCharge({ providerCostMicroUsd: '1000', policy });
assert.strictEqual(charge.safeguardedProviderCostMicroUsd, '1200');
assert.strictEqual(charge.safeguardedCostMicroUsd, '3200');
assert.strictEqual(charge.minimumRevenueMicroUsd, '6400');
assert.strictEqual(charge.chargedCredits, '7');
assert(Number(charge.grossMarginBps) >= 5000);

const zeroProviderCharge = calculateCharge({ providerCostMicroUsd: '0', policy });
assert.strictEqual(zeroProviderCharge.chargedCredits, '4');
assert(Number(zeroProviderCharge.grossMarginBps) >= 5000);

assert.throws(
  () => calculateCharge({ providerCostMicroUsd: '1.5', policy }),
  error => error.code === 'invalid_provider_cost_micro_usd'
);

assert.throws(
  () => calculateCharge({
    providerCostMicroUsd: '1000',
    policy: { ...policy, targetGrossMarginBps: 10000 }
  }),
  error => error.code === 'invalid_target_gross_margin_bps'
);

validateRegistry(registry);
const now = Date.parse('2026-09-12T00:00:00Z');

const groqEntry = resolveCostEntry({
  provider: 'groq',
  modelToolId: 'openai/gpt-oss-20b',
  capability: 'chat',
  operationType: 'text_generation'
}, { env: { ZUVYR_GROQ_FREE_TIER_CONFIRMED: 'true' }, now });

assert.strictEqual(
  estimateProviderCostMicroUsd(groqEntry, { input_tokens: 1000, output_tokens: 500 }),
  '225'
);

const samePublishedEntry = resolveCostEntry({
  provider: 'groq',
  modelToolId: 'openai/gpt-oss-20b',
  capability: 'chat',
  operationType: 'text_generation'
}, { env: {}, now });

assert.strictEqual(
  estimateProviderCostMicroUsd(samePublishedEntry, { input_tokens: 1000, output_tokens: 500 }),
  '225'
);

assert.throws(
  () => resolveCostEntry({
    provider: 'openrouter',
    modelToolId: 'google/gemini-2.5-flash',
    capability: 'multimodal_chat',
    operationType: 'multimodal_generation'
  }, { now }),
  error => error.code === 'cost_entry_blocked'
);

assert.throws(
  () => resolveCostEntry({
    provider: 'missing',
    modelToolId: 'missing',
    capability: 'chat',
    operationType: 'text_generation'
  }, { now }),
  error => error.code === 'unknown_cost_entry'
);

console.log('PASS: exact micro-USD economics and 50% margin invariant');
console.log('PASS: Pack 014 authoritative registry replaces free-tier zero-price assumptions');
console.log('DATABASE / STRIPE / MODEL / NETWORK CALLS: NONE');
