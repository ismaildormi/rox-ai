'use strict';

const assert = require('assert');
const basePolicy = require('./config/usage-policy.v1.json');
const {
  evaluateAllowance,
  settleReservation,
  buildIdempotentLedger,
  validateUsagePolicy
} = require('./lib/allowanceEngine');

validateUsagePolicy(basePolicy);

const configured = JSON.parse(JSON.stringify(basePolicy));
configured.allowances.plans.plus = {
  fiveHourUnits: 10,
  weeklyUnits: 20,
  status: 'configured'
};

const now = '2026-09-06T12:00:00.000Z';
const profile = {
  plan: 'plus',
  billingStatus: 'active',
  subscriptionPeriodStart: '2026-09-01T00:00:00.000Z',
  fiveHourStartedAt: null,
  fiveHourEndsAt: null,
  fiveHourUsed: 0,
  weeklyStartedAt: null,
  weeklyUsed: 0,
  topupCreditsBalance: 50
};

const disabled = evaluateAllowance({
  now,
  profile,
  requestedUnits: 3,
  value: configured
});
assert.strictEqual(disabled.code, 'usage_enforcement_disabled');

const unconfigured = evaluateAllowance({
  now,
  profile,
  requestedUnits: 3,
  value: basePolicy,
  enforcementOverride: true
});
assert.strictEqual(unconfigured.code, 'plan_limits_unconfigured');

const allowed = evaluateAllowance({
  now,
  profile,
  requestedUnits: 3,
  value: configured,
  enforcementOverride: true
});

assert.strictEqual(allowed.source, 'subscription');
assert.strictEqual(allowed.fiveHour.startedAt, now);
assert.strictEqual(
  allowed.fiveHour.endsAt,
  '2026-09-06T17:00:00.000Z'
);
assert.strictEqual(allowed.weekly.startedAt, '2026-09-01T00:00:00.000Z');
assert.strictEqual(allowed.weekly.endsAt, '2026-09-08T00:00:00.000Z');
assert.strictEqual(allowed.fiveHour.remainingAfterReservation, 7);
assert.strictEqual(allowed.weekly.remainingAfterReservation, 17);

const reset = evaluateAllowance({
  now,
  profile: {
    ...profile,
    fiveHourStartedAt: '2026-09-06T05:00:00.000Z',
    fiveHourEndsAt: '2026-09-06T10:00:00.000Z',
    fiveHourUsed: 10
  },
  requestedUnits: 2,
  value: configured,
  enforcementOverride: true
});
assert.strictEqual(reset.fiveHour.used, 0);
assert.strictEqual(reset.fiveHour.remainingAfterReservation, 8);

const fiveHourExhausted = evaluateAllowance({
  now,
  profile: {
    ...profile,
    fiveHourStartedAt: '2026-09-06T11:00:00.000Z',
    fiveHourEndsAt: '2026-09-06T16:00:00.000Z',
    fiveHourUsed: 9,
    weeklyStartedAt: '2026-09-01T00:00:00.000Z',
    weeklyUsed: 5
  },
  requestedUnits: 2,
  value: configured,
  enforcementOverride: true
});
assert.strictEqual(fiveHourExhausted.exhaustedLimit, 'five_hour');
assert.strictEqual(
  fiveHourExhausted.fiveHourResetAt,
  '2026-09-06T16:00:00.000Z'
);

const weeklyExhausted = evaluateAllowance({
  now,
  profile: {
    ...profile,
    fiveHourStartedAt: '2026-09-06T11:00:00.000Z',
    fiveHourEndsAt: '2026-09-06T16:00:00.000Z',
    fiveHourUsed: 1,
    weeklyStartedAt: '2026-09-01T00:00:00.000Z',
    weeklyUsed: 19
  },
  requestedUnits: 2,
  value: configured,
  enforcementOverride: true
});
assert.strictEqual(weeklyExhausted.exhaustedLimit, 'weekly');

const topup = evaluateAllowance({
  now,
  profile: {
    ...profile,
    fiveHourStartedAt: '2026-09-06T11:00:00.000Z',
    fiveHourEndsAt: '2026-09-06T16:00:00.000Z',
    fiveHourUsed: 10
  },
  requestedUnits: 4,
  allowTopupFallback: true,
  value: configured,
  enforcementOverride: true
});
assert.strictEqual(topup.source, 'topup');
assert.strictEqual(topup.topupCreditsAfterReservation, 46);

for (const billingStatus of ['inactive', 'paused', 'canceled']) {
  const inactive = evaluateAllowance({
    now,
    profile: { ...profile, billingStatus },
    requestedUnits: 2,
    value: configured,
    enforcementOverride: true
  });
  assert.strictEqual(inactive.code, 'subscription_inactive');
  assert.strictEqual(inactive.topupCreditsBalance, 50);
}

assert.deepStrictEqual(
  settleReservation({ reservedUnits: 10, actualUnits: 4 }),
  {
    reservedUnits: 10,
    actualUnits: 4,
    refundedUnits: 6,
    complete: true
  }
);
assert.strictEqual(
  settleReservation({ reservedUnits: 10, actualUnits: 0 }).refundedUnits,
  10
);
assert.throws(
  () => settleReservation({ reservedUnits: 10, actualUnits: 11 }),
  error => error.code === 'actual_usage_exceeds_reservation'
);

const ledger = buildIdempotentLedger();
let calls = 0;
const first = ledger.reserve('request-1', () => {
  calls += 1;
  return { reservedUnits: 10 };
});
const replay = ledger.reserve('request-1', () => {
  calls += 1;
  return { reservedUnits: 10 };
});
assert.strictEqual(first.replayed, false);
assert.strictEqual(replay.replayed, true);
assert.strictEqual(calls, 1);

console.log('PASS: five-hour and anchored weekly allowance windows');
console.log('PASS: exhaustion, explicit top-up fallback and persistent balance');
console.log('PASS: partial/full refund and idempotent retry behavior');
console.log('DATABASE / STRIPE / MODEL / NETWORK CALLS: NONE');
