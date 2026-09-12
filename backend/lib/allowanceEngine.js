'use strict';

const policy = require('../config/usage-policy.v1.json');
const {
  PAID_PLAN_IDS,
  canonicalPlanIdFromProfile
} = require('./planEntitlements');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PAID_PLANS = Object.freeze([...PAID_PLAN_IDS]);

function allowanceError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function wholeUnits(value, name, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) {
    return null;
  }

  const result = Number(value);

  if (!Number.isSafeInteger(result) || result < 0) {
    throw allowanceError(`invalid_${name}`);
  }

  return result;
}

function instant(value, name) {
  const result = value instanceof Date
    ? new Date(value.getTime())
    : new Date(value);

  if (!Number.isFinite(result.getTime())) {
    throw allowanceError(`invalid_${name}`);
  }

  return result;
}

function iso(value) {
  return value ? instant(value, 'timestamp').toISOString() : null;
}

function validateUsagePolicy(value = policy) {
  if (value.version !== 'pack-01.v1') {
    throw allowanceError('invalid_usage_policy_version');
  }

  if (value.enforcement.enabledByDefault !== false) {
    throw allowanceError('usage_enforcement_must_default_off');
  }

  if (
    wholeUnits(value.allowances.fiveHourWindowHours, 'five_hour_window_hours') !== 5 ||
    wholeUnits(value.allowances.weeklyWindowDays, 'weekly_window_days') !== 7
  ) {
    throw allowanceError('invalid_allowance_windows');
  }

  for (const planId of PAID_PLANS) {
    const limits = value.allowances.plans[planId];

    if (!limits) {
      throw allowanceError(`missing_plan_limits_${planId}`);
    }

    const fiveHour = wholeUnits(
      limits.fiveHourUnits,
      `${planId}_five_hour_units`,
      { nullable: true }
    );
    const weekly = wholeUnits(
      limits.weeklyUnits,
      `${planId}_weekly_units`,
      { nullable: true }
    );

    if ((fiveHour === null || weekly === null) && limits.status !== 'unconfigured') {
      throw allowanceError(`invalid_plan_limit_status_${planId}`);
    }
  }

  return value;
}

function enforcementEnabled({
  env = process.env,
  value = policy,
  override
} = {}) {
  validateUsagePolicy(value);

  if (override !== undefined) {
    return override === true;
  }

  return value.enforcement.enabledByDefault === true &&
    env[value.enforcement.environmentFlag] === 'true';
}

function normalizeFiveHourWindow({ now, profile, value = policy }) {
  const current = instant(now, 'now');
  const started = profile.fiveHourStartedAt
    ? instant(profile.fiveHourStartedAt, 'five_hour_started_at')
    : null;
  const ended = profile.fiveHourEndsAt
    ? instant(profile.fiveHourEndsAt, 'five_hour_ends_at')
    : null;
  const valid = started && ended &&
    ended.getTime() > current.getTime() &&
    started.getTime() <= current.getTime();

  if (valid) {
    return {
      startedAt: started.toISOString(),
      endsAt: ended.toISOString(),
      used: wholeUnits(profile.fiveHourUsed || 0, 'five_hour_used')
    };
  }

  return {
    startedAt: current.toISOString(),
    endsAt: new Date(
      current.getTime() +
      value.allowances.fiveHourWindowHours * HOUR_MS
    ).toISOString(),
    used: 0
  };
}

function normalizeWeeklyWindow({ now, profile, value = policy }) {
  const current = instant(now, 'now');
  const anchor = instant(
    profile.subscriptionPeriodStart,
    'subscription_period_start'
  );

  if (current.getTime() < anchor.getTime()) {
    throw allowanceError('weekly_anchor_is_in_the_future');
  }

  const duration = value.allowances.weeklyWindowDays * DAY_MS;
  const index = Math.floor(
    (current.getTime() - anchor.getTime()) / duration
  );
  const started = new Date(anchor.getTime() + index * duration);
  const ended = new Date(started.getTime() + duration);
  const storedStart = profile.weeklyStartedAt
    ? instant(profile.weeklyStartedAt, 'weekly_started_at')
    : null;
  const sameWindow = storedStart &&
    storedStart.getTime() === started.getTime();

  return {
    startedAt: started.toISOString(),
    endsAt: ended.toISOString(),
    used: sameWindow
      ? wholeUnits(profile.weeklyUsed || 0, 'weekly_used')
      : 0
  };
}

function topupDecision({ requestedUnits, profile, exhaustedLimit }) {
  const balance = wholeUnits(
    profile.topupCreditsBalance || 0,
    'topup_credits_balance'
  );

  if (balance < requestedUnits) {
    return {
      allowed: false,
      code: exhaustedLimit || 'insufficient_topup_credits',
      exhaustedLimit: exhaustedLimit || 'topup',
      topupCreditsBalance: balance,
      topupCreditsRequired: requestedUnits
    };
  }

  return {
    allowed: true,
    code: 'topup_credits_selected',
    source: 'topup',
    reservedUnits: requestedUnits,
    exhaustedLimit: exhaustedLimit || null,
    topupCreditsBalance: balance,
    topupCreditsAfterReservation: balance - requestedUnits
  };
}

function evaluateAllowance({
  now,
  profile,
  requestedUnits,
  allowTopupFallback = false,
  value = policy,
  enforcementOverride
}) {
  validateUsagePolicy(value);
  const units = wholeUnits(requestedUnits, 'requested_units');

  if (units <= 0) {
    throw allowanceError('invalid_requested_units');
  }

  if (!enforcementEnabled({ value, override: enforcementOverride })) {
    return {
      allowed: false,
      code: 'usage_enforcement_disabled'
    };
  }

  const planId = canonicalPlanIdFromProfile(profile);
  const billingStatus =
    typeof profile.billingStatus === 'string'
      ? profile.billingStatus
      : profile.billing_status;
  const eligibleStatus = value.enforcement.eligibleBillingStatuses.includes(
    billingStatus
  );
  const topupPermitted = allowTopupFallback === true;

  if (!PAID_PLANS.includes(planId) || !eligibleStatus) {
    return topupPermitted
      ? topupDecision({ requestedUnits: units, profile })
      : {
          allowed: false,
          code: 'subscription_inactive',
          exhaustedLimit: 'subscription',
          topupCreditsBalance: wholeUnits(
            profile.topupCreditsBalance || 0,
            'topup_credits_balance'
          )
        };
  }

  const limits = value.allowances.plans[planId];

  if (
    limits.fiveHourUnits === null ||
    limits.weeklyUnits === null
  ) {
    return topupPermitted
      ? topupDecision({
          requestedUnits: units,
          profile,
          exhaustedLimit: 'plan_limits_unconfigured'
        })
      : {
          allowed: false,
          code: 'plan_limits_unconfigured',
          exhaustedLimit: 'configuration',
          topupCreditsBalance: wholeUnits(
            profile.topupCreditsBalance || 0,
            'topup_credits_balance'
          )
        };
  }

  const fiveHour = normalizeFiveHourWindow({ now, profile, value });
  const weekly = normalizeWeeklyWindow({ now, profile, value });
  const fiveTotal = wholeUnits(
    limits.fiveHourUnits,
    'five_hour_total'
  );
  const weeklyTotal = wholeUnits(
    limits.weeklyUnits,
    'weekly_total'
  );
  const fiveRemaining = Math.max(0, fiveTotal - fiveHour.used);
  const weeklyRemaining = Math.max(0, weeklyTotal - weekly.used);
  let exhaustedLimit = null;

  if (fiveRemaining < units) exhaustedLimit = 'five_hour';
  if (weeklyRemaining < units) exhaustedLimit = exhaustedLimit || 'weekly';

  if (exhaustedLimit) {
    return topupPermitted
      ? topupDecision({ requestedUnits: units, profile, exhaustedLimit })
      : {
          allowed: false,
          code: `${exhaustedLimit}_allowance_exhausted`,
          exhaustedLimit,
          fiveHourRemaining: fiveRemaining,
          fiveHourResetAt: fiveHour.endsAt,
          weeklyRemaining,
          weeklyResetAt: weekly.endsAt,
          topupCreditsBalance: wholeUnits(
            profile.topupCreditsBalance || 0,
            'topup_credits_balance'
          )
        };
  }

  return {
    allowed: true,
    code: 'subscription_allowance_selected',
    source: 'subscription',
    reservedUnits: units,
    fiveHour: {
      ...fiveHour,
      total: fiveTotal,
      remainingBefore: fiveRemaining,
      usedAfterReservation: fiveHour.used + units,
      remainingAfterReservation: fiveRemaining - units
    },
    weekly: {
      ...weekly,
      total: weeklyTotal,
      remainingBefore: weeklyRemaining,
      usedAfterReservation: weekly.used + units,
      remainingAfterReservation: weeklyRemaining - units
    },
    topupCreditsBalance: wholeUnits(
      profile.topupCreditsBalance || 0,
      'topup_credits_balance'
    )
  };
}

function settleReservation({ reservedUnits, actualUnits }) {
  const reserved = wholeUnits(reservedUnits, 'reserved_units');
  const actual = wholeUnits(actualUnits, 'actual_units');

  if (actual > reserved) {
    throw allowanceError('actual_usage_exceeds_reservation');
  }

  return Object.freeze({
    reservedUnits: reserved,
    actualUnits: actual,
    refundedUnits: reserved - actual,
    complete: true
  });
}

function buildIdempotentLedger() {
  const records = new Map();

  return Object.freeze({
    reserve(idempotencyKey, createReservation) {
      if (!idempotencyKey) {
        throw allowanceError('idempotency_key_required');
      }

      if (records.has(idempotencyKey)) {
        return {
          ...records.get(idempotencyKey),
          replayed: true
        };
      }

      const reservation = Object.freeze({
        ...createReservation(),
        idempotencyKey,
        replayed: false
      });
      records.set(idempotencyKey, reservation);
      return reservation;
    },
    get(idempotencyKey) {
      return records.get(idempotencyKey) || null;
    }
  });
}

module.exports = {
  HOUR_MS,
  DAY_MS,
  PAID_PLANS,
  policy,
  allowanceError,
  validateUsagePolicy,
  enforcementEnabled,
  normalizeFiveHourWindow,
  normalizeWeeklyWindow,
  evaluateAllowance,
  settleReservation,
  buildIdempotentLedger,
  iso
};
