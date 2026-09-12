'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  calculateCharge
} = require('./lib/exactMoney');
const {
  policy,
  buildTechnicalCostTrace,
  quoteTechnicalCost
} = require('./lib/technicalCostModel');
const {
  quoteGeneration,
  economicsFromEnv
} = require('./lib/dynamicPricing');

assert.equal(policy.version, 'pack-015.full-technical-cost-model.v1');
assert.equal(policy.amountUnit, 'micro_usd_integer_string');
assert.equal(policy.unknownCostMode, 'fail_closed');

for (const kind of [
  'provider',
  'infrastructure',
  'storage',
  'bandwidth',
  'retry',
  'sandbox',
  'browser',
  'media',
  'preview_startup',
  'preview_build',
  'preview_hmr',
  'active_runtime',
  'idle_runtime',
  'proxy',
  'egress',
  'cleanup'
]) {
  assert(policy.componentKinds.includes(kind), 'missing technical component ' + kind);
}

for (const phase of [
  'startup',
  'build',
  'hmr',
  'activeRuntime',
  'idleRuntime',
  'proxy',
  'egress',
  'cleanup',
  'retry'
]) {
  assert(policy.codeStudioLivePreviewMeasurementContract[phase], 'missing live preview phase ' + phase);
  assert.equal(
    policy.codeStudioLivePreviewMeasurementContract[phase].pricingState,
    'blocked_until_verified'
  );
}

const trace = buildTechnicalCostTrace({
  providerCostMicroUsd: '1000',
  infrastructureCostMicroUsd: '2000',
  pricingVersion: 'registry-test-v1',
  basis: 'actual',
  components: [
    { kind: 'storage', microUsd: '7', costKnown: true, verified: true, source: 'meter:storage' },
    { kind: 'egress', microUsd: '3', costKnown: true, verified: true, source: 'meter:egress' },
    { kind: 'retry', microUsd: '5', costKnown: true, verified: true, source: 'meter:retry' }
  ]
});
assert.equal(trace.providerCostMicroUsd, '1000');
assert.equal(trace.infrastructureCostMicroUsd, '2000');
assert.equal(trace.measuredOverheadMicroUsd, '15');
assert.equal(trace.allInTechnicalCostMicroUsd, '3015');
assert.equal(trace.costKnown, true);

assert.throws(
  () => buildTechnicalCostTrace({
    providerCostMicroUsd: '1',
    pricingVersion: 'v1',
    components: [
      { kind: 'storage', microUsd: '1', costKnown: false, verified: true, source: 'x' }
    ]
  }),
  { code: 'technical_cost_unknown_storage' }
);

assert.throws(
  () => buildTechnicalCostTrace({
    providerCostMicroUsd: '1',
    pricingVersion: 'v1',
    components: [
      { kind: 'storage', microUsd: '1', costKnown: true, verified: false, source: 'x' }
    ]
  }),
  { code: 'technical_cost_unverified_storage' }
);

const economics = {
  creditValueMicroUsd: '1000',
  minimumChargeCredits: '1',
  targetGrossMarginBps: 5000,
  providerCostReserveBps: 1000,
  retryFailureReserveBps: 500,
  currencyChangeReserveBps: 500,
  infrastructureReserveMicroUsd: '2000'
};

const charge = calculateCharge({
  providerCostMicroUsd: '1000',
  technicalCostComponents: [
    { kind: 'storage', microUsd: '100', costKnown: true, verified: true, source: 'test' }
  ],
  policy: economics
});
assert.equal(charge.safeguardedProviderCostMicroUsd, '1200');
assert.equal(charge.measuredTechnicalCostMicroUsd, '100');
assert.equal(charge.rawTechnicalCostMicroUsd, '3100');
assert.equal(charge.safeguardedCostMicroUsd, '3300');
assert(BigInt(charge.grossMarginBps) >= 5000n);

const technicalQuote = quoteTechnicalCost({
  providerCostMicroUsd: '1000',
  pricingVersion: 'registry-test-v1',
  basis: 'estimate',
  economics,
  components: [
    { kind: 'sandbox', microUsd: '100', costKnown: true, verified: true, source: 'test:sandbox' }
  ]
});
assert.equal(technicalQuote.trace.allInTechnicalCostMicroUsd, '3100');
assert.equal(technicalQuote.charge.safeguardedCostMicroUsd, '3300');
assert.equal(
  technicalQuote.settlementAudit.technicalCostModelVersion,
  'pack-015.full-technical-cost-model.v1'
);

const envEconomics = economicsFromEnv({});
assert.equal(envEconomics.creditValueMicroUsd, '10000');
assert.equal(envEconomics.targetNetMarginBps, '5000');
assert.equal(envEconomics.paymentFeeBps, '600');
assert.equal(envEconomics.taxReserveBps, '1000');
assert.equal(envEconomics.riskReserveBps, '500');
assert.equal(envEconomics.infrastructureReserveMicroUsd, '2000');

const generation = quoteGeneration('image', {
  now: Date.parse('2026-09-12T00:00:00Z'),
  env: {
    FAL_KEY: 'configured',
    FAL_IMAGE_COST_USD: '0.025'
  }
});
assert.equal(generation.provider, 'fal');
assert.equal(generation.providerCostMicroUsd, '25000');
assert.equal(generation.infrastructureCostMicroUsd, '2000');
assert.equal(generation.technicalCostMicroUsd, '27000');
assert.equal(generation.credits, 10);
assert.equal(generation.revenueMicroUsd, '100000');
assert.equal(generation.variableReservesMicroUsd, '21000');
assert.equal(generation.estimatedNetProfitMicroUsd, '52000');
assert.equal(generation.estimatedNetMarginBps, '5200');
assert.equal(generation.pricingDecisionMode, 'exact_integer_micro_usd');

const dynamicRaw = fs.readFileSync(
  path.join(__dirname, 'lib/dynamicPricing.js'),
  'utf8'
);
for (const forbidden of ['Math.ceil', '.toFixed(', 'Number(providerCostMicroUsd)']) {
  assert(!dynamicRaw.includes(forbidden), 'unsafe pricing decision marker remains: ' + forbidden);
}
assert(dynamicRaw.includes('display/API'));
assert(dynamicRaw.includes('exact_integer_micro_usd'));

const registry = require('./config/cost-registry.v1.json');
for (const operationType of [
  'build_job',
  'sandbox_runtime',
  'preview_runtime',
  'preview_egress',
  'idle_session'
]) {
  const entry = registry.entries.find(item =>
    item.provider === 'unassigned' &&
    item.modelToolId === 'code-studio-runtime' &&
    item.operationType === operationType
  );
  assert(entry, 'missing Code Studio registry contract ' + operationType);
  assert.equal(entry.enabledState, 'blocked');
  assert.equal(entry.verificationStatus, 'unverified');
}

console.log('PASS: Pack 015 uses exact integer micro-USD for pricing decisions and all-in technical-cost traces');
console.log('PASS: provider + infrastructure + measured storage/bandwidth/retry/sandbox/browser/media overheads are fail-closed unless verified');
console.log('PASS: Live Preview startup/build/HMR/active/idle/proxy/egress/cleanup/retry measurement contracts exist without inventing prices');
console.log('DATABASE / PROVIDER / PAYMENT / NETWORK CALLS: NONE');
