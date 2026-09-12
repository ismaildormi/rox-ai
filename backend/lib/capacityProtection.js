'use strict';

const policy = require('../config/usage-policy.v1.json');

const CAPACITY_CONTRACT_VERSION =
  'pack-017.capacity-protection.v1';

function capacityError(code) {
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
    throw capacityError(`invalid_${name}`);
  }

  return result;
}

function validateCapacityProtection(value = policy) {
  if (!value || typeof value !== 'object') {
    throw capacityError('invalid_capacity_policy');
  }

  if (value.version !== 'pack-01.v1') {
    throw capacityError('invalid_usage_policy_version');
  }

  const protection = value.capacityProtection;

  if (
    !protection ||
    protection.version !== CAPACITY_CONTRACT_VERSION
  ) {
    throw capacityError('invalid_capacity_protection_version');
  }

  if (
    wholeUnits(
      value.allowances?.fiveHourWindowHours,
      'five_hour_window_hours'
    ) !== 5 ||
    wholeUnits(
      value.allowances?.weeklyWindowDays,
      'weekly_window_days'
    ) !== 7
  ) {
    throw capacityError('invalid_capacity_windows');
  }

  if (
    value.allowances?.weeklyAnchorField !==
    'subscription_current_period_start'
  ) {
    throw capacityError('invalid_weekly_anchor');
  }

  if (
    value.allowances?.topupFallbackRequiresExplicitPermission !== true
  ) {
    throw capacityError('topup_fallback_must_require_permission');
  }

  if (value.allowances?.topupCreditsExpire !== false) {
    throw capacityError('purchased_topups_must_not_expire');
  }

  const expectedOrder = [
    'subscription_allowance',
    'explicit_topup_credits',
    'reject'
  ];

  if (
    JSON.stringify(value.allowances?.consumptionOrder) !==
    JSON.stringify(expectedOrder)
  ) {
    throw capacityError('invalid_capacity_consumption_order');
  }

  if (
    JSON.stringify(
      protection.warningRemainingPercentThresholds
    ) !== JSON.stringify([20, 10, 5])
  ) {
    throw capacityError('invalid_capacity_warning_thresholds');
  }

  if (
    protection.productionEnforcementDefault !== false ||
    value.enforcement?.enabledByDefault !== false
  ) {
    throw capacityError(
      'capacity_enforcement_must_default_off'
    );
  }

  if (
    protection.fiveHourStartRule !==
    'first_subscription_funded_use_after_expiry' ||
    protection.weeklyRenewalRule !==
    'seven_day_boundaries_from_subscription_period_start' ||
    protection.purchasedTopupPolicy !==
    'persistent_non_expiring'
  ) {
    throw capacityError('invalid_capacity_protection_contract');
  }

  return value;
}

function warningForRemaining(total, remaining, value = policy) {
  validateCapacityProtection(value);

  const normalizedTotal = wholeUnits(
    total,
    'capacity_warning_total',
    { nullable: true }
  );
  const normalizedRemaining = wholeUnits(
    remaining,
    'capacity_warning_remaining',
    { nullable: true }
  );

  if (
    normalizedTotal === null ||
    normalizedRemaining === null ||
    normalizedTotal === 0
  ) {
    return null;
  }

  const boundedRemaining =
    normalizedRemaining > normalizedTotal
      ? normalizedTotal
      : normalizedRemaining;

  let crossed = null;

  for (
    const threshold of
    value.capacityProtection.warningRemainingPercentThresholds
  ) {
    if (
      boundedRemaining * 100 <=
      normalizedTotal * threshold
    ) {
      crossed = threshold;
    }
  }

  return crossed;
}

function buildCapacityWarnings(
  {
    fiveHourTotal = null,
    fiveHourRemaining = null,
    weeklyTotal = null,
    weeklyRemaining = null
  } = {},
  value = policy
) {
  validateCapacityProtection(value);

  return Object.freeze({
    fiveHourRemainingPercentThreshold:
      warningForRemaining(
        fiveHourTotal,
        fiveHourRemaining,
        value
      ),
    weeklyRemainingPercentThreshold:
      warningForRemaining(
        weeklyTotal,
        weeklyRemaining,
        value
      )
  });
}

function publicCapacityContract(value = policy) {
  validateCapacityProtection(value);

  return Object.freeze({
    version: CAPACITY_CONTRACT_VERSION,
    fiveHourWindowHours:
      value.allowances.fiveHourWindowHours,
    weeklyWindowDays:
      value.allowances.weeklyWindowDays,
    weeklyAnchorField:
      value.allowances.weeklyAnchorField,
    warningRemainingPercentThresholds:
      Object.freeze([
        ...value.capacityProtection
          .warningRemainingPercentThresholds
      ]),
    consumptionOrder:
      Object.freeze([
        ...value.allowances.consumptionOrder
      ]),
    purchasedTopupsExpire:
      value.allowances.topupCreditsExpire,
    topupFallbackRequiresExplicitPermission:
      value.allowances
        .topupFallbackRequiresExplicitPermission,
    productionEnforcementDefault:
      value.enforcement.enabledByDefault,
    productionPlanLimitsConfigured: false
  });
}

module.exports = {
  CAPACITY_CONTRACT_VERSION,
  validateCapacityProtection,
  warningForRemaining,
  buildCapacityWarnings,
  publicCapacityContract
};
