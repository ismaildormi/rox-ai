'use strict';

const assert = require('assert');
const { buildUsageContract } = require('./lib/usageContract');

const result = buildUsageContract({
  profile: {
    plan: 'pro',
    billingStatus: 'active',
    fiveHourTotal: 100,
    fiveHourUsed: 25,
    fiveHourResetAt: '2026-09-06T17:00:00.000Z',
    weeklyTotal: 500,
    weeklyUsed: 100,
    weeklyResetAt: '2026-09-08T00:00:00.000Z',
    topupCreditsBalance: 900
  },
  estimate: { chargedCredits: '8' },
  settlement: { actualUnits: 6 },
  decision: {
    source: 'topup',
    exhaustedLimit: 'five_hour',
    code: 'topup_credits_selected'
  },
  pricingVersion: 'pack-01.costs.v1'
});

assert.deepStrictEqual(result, {
  currentPlan: 'pro',
  billingStatus: 'active',
  fiveHourAllowance: {
    total: 100,
    used: 25,
    remaining: 75,
    resetAt: '2026-09-06T17:00:00.000Z'
  },
  weeklyAllowance: {
    total: 500,
    used: 100,
    remaining: 400,
    resetAt: '2026-09-08T00:00:00.000Z'
  },
  persistentTopupBalance: 900,
  estimatedCreditCost: '8',
  actualCreditCost: '6',
  topupCreditsWillBeUsed: true,
  exhaustedLimitType: 'five_hour',
  reasonCode: 'topup_credits_selected',
  pricingVersion: 'pack-01.costs.v1'
});

const unconfigured = buildUsageContract();
assert.strictEqual(unconfigured.fiveHourAllowance.total, null);
assert.strictEqual(unconfigured.weeklyAllowance.total, null);
assert.strictEqual(unconfigured.estimatedCreditCost, null);

console.log('PASS: backward-compatible structured usage domain contract');
console.log('DATABASE / STRIPE / MODEL / NETWORK CALLS: NONE');
