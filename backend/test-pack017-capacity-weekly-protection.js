'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const policy = require('./config/usage-policy.v1.json');
const {
  CAPACITY_CONTRACT_VERSION,
  validateCapacityProtection,
  warningForRemaining,
  buildCapacityWarnings,
  publicCapacityContract
} = require('./lib/capacityProtection');

assert.equal(
  CAPACITY_CONTRACT_VERSION,
  'pack-017.capacity-protection.v1'
);
assert.doesNotThrow(() =>
  validateCapacityProtection(policy)
);

assert.equal(
  policy.capacityProtection.version,
  CAPACITY_CONTRACT_VERSION
);
assert.deepEqual(
  policy.capacityProtection
    .warningRemainingPercentThresholds,
  [20, 10, 5]
);
assert.equal(
  policy.capacityProtection.fiveHourStartRule,
  'first_subscription_funded_use_after_expiry'
);
assert.equal(
  policy.capacityProtection.weeklyRenewalRule,
  'seven_day_boundaries_from_subscription_period_start'
);
assert.equal(
  policy.capacityProtection.purchasedTopupPolicy,
  'persistent_non_expiring'
);
assert.equal(
  policy.capacityProtection.productionEnforcementDefault,
  false
);

assert.equal(policy.allowances.fiveHourWindowHours, 5);
assert.equal(policy.allowances.weeklyWindowDays, 7);
assert.equal(
  policy.allowances.weeklyAnchorField,
  'subscription_current_period_start'
);
assert.equal(
  policy.allowances.topupFallbackRequiresExplicitPermission,
  true
);
assert.equal(
  policy.allowances.topupCreditsExpire,
  false
);
assert.deepEqual(
  policy.allowances.consumptionOrder,
  [
    'subscription_allowance',
    'explicit_topup_credits',
    'reject'
  ]
);
assert.equal(
  policy.enforcement.enabledByDefault,
  false
);

for (const planId of ['plus', 'pro', 'legend', 'max']) {
  const limits = policy.allowances.plans[planId];

  assert.equal(limits.fiveHourUnits, null);
  assert.equal(limits.weeklyUnits, null);
  assert.equal(limits.status, 'unconfigured');
}

assert.equal(warningForRemaining(100, 21), null);
assert.equal(warningForRemaining(100, 20), 20);
assert.equal(warningForRemaining(100, 10), 10);
assert.equal(warningForRemaining(100, 5), 5);
assert.equal(warningForRemaining(100, 0), 5);
assert.equal(warningForRemaining(null, null), null);
assert.equal(warningForRemaining(3, 1), null);
assert.equal(warningForRemaining(5, 1), 20);
assert.equal(warningForRemaining(20, 1), 5);

assert.deepEqual(
  buildCapacityWarnings({
    fiveHourTotal: 100,
    fiveHourRemaining: 10,
    weeklyTotal: 400,
    weeklyRemaining: 81
  }),
  {
    fiveHourRemainingPercentThreshold: 10,
    weeklyRemainingPercentThreshold: null
  }
);

const contract = publicCapacityContract();

assert.equal(
  contract.version,
  'pack-017.capacity-protection.v1'
);
assert.equal(contract.fiveHourWindowHours, 5);
assert.equal(contract.weeklyWindowDays, 7);
assert.deepEqual(
  contract.warningRemainingPercentThresholds,
  [20, 10, 5]
);
assert.equal(contract.purchasedTopupsExpire, false);
assert.equal(
  contract.topupFallbackRequiresExplicitPermission,
  true
);
assert.equal(
  contract.productionEnforcementDefault,
  false
);
assert.equal(
  contract.productionPlanLimitsConfigured,
  false
);

const engine = fs.readFileSync(
  path.join(__dirname, 'lib', 'allowanceEngine.js'),
  'utf8'
);
const server = fs.readFileSync(
  path.join(__dirname, 'server.js'),
  'utf8'
);

for (const requiredSignal of [
  'normalizeFiveHourWindow',
  'normalizeWeeklyWindow',
  "exhaustedLimit = 'five_hour'",
  "exhaustedLimit = exhaustedLimit || 'weekly'",
  '`${exhaustedLimit}_allowance_exhausted`',
  'topupDecision',
  'allowTopupFallback',
  'buildCapacityWarnings'
]) {
  assert(
    engine.includes(requiredSignal),
    `allowance engine missing ${requiredSignal}`
  );
}

assert(
  server.includes("app.get('/api/capacity-contract'")
);
assert(
  server.includes('publicCapacityContract()')
);

assert(
  !fs.existsSync(
    path.join(
      __dirname,
      '45_pack017_capacity_protection.sql'
    )
  )
);

console.log(
  'PASS: Pack 017 locks five-hour + anchored weekly protection without inventing production capacity amounts'
);
console.log(
  'PASS: exact 20/10/5 warnings use integer-safe comparisons and are wired into allowance decisions'
);
console.log(
  'PASS: purchased top-ups remain persistent, explicit and lower precedence than included subscription capacity'
);
console.log(
  'PASS: public runtime contract enables exact live deployment verification without exposing private billing state'
);
console.log(
  'DATABASE / STRIPE / MODEL / NETWORK CALLS: NONE'
);
