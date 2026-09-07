'use strict';

function nullableNumber(value) {
  return value === null || value === undefined
    ? null
    : Number(value);
}

function nullableIso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : null;
}

function buildUsageContract({
  profile = {},
  estimate = null,
  settlement = null,
  decision = null,
  pricingVersion = null
} = {}) {
  const fiveTotal = nullableNumber(profile.fiveHourTotal);
  const fiveUsed = nullableNumber(profile.fiveHourUsed);
  const weeklyTotal = nullableNumber(profile.weeklyTotal);
  const weeklyUsed = nullableNumber(profile.weeklyUsed);

  return Object.freeze({
    currentPlan: profile.plan || 'free',
    billingStatus: profile.billingStatus || 'inactive',
    fiveHourAllowance: {
      total: fiveTotal,
      used: fiveUsed,
      remaining:
        fiveTotal === null || fiveUsed === null
          ? null
          : Math.max(0, fiveTotal - fiveUsed),
      resetAt: nullableIso(profile.fiveHourResetAt)
    },
    weeklyAllowance: {
      total: weeklyTotal,
      used: weeklyUsed,
      remaining:
        weeklyTotal === null || weeklyUsed === null
          ? null
          : Math.max(0, weeklyTotal - weeklyUsed),
      resetAt: nullableIso(profile.weeklyResetAt)
    },
    persistentTopupBalance: nullableNumber(
      profile.topupCreditsBalance || 0
    ),
    estimatedCreditCost:
      estimate?.chargedCredits === undefined
        ? null
        : String(estimate.chargedCredits),
    actualCreditCost:
      settlement?.actualUnits === undefined
        ? null
        : String(settlement.actualUnits),
    topupCreditsWillBeUsed: decision?.source === 'topup',
    exhaustedLimitType: decision?.exhaustedLimit || null,
    reasonCode: decision?.code || null,
    pricingVersion
  });
}

module.exports = {
  buildUsageContract
};
