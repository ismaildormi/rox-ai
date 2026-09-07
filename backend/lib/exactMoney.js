'use strict';

const BPS_SCALE = 10000n;

function financialError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function integer(value, name, { allowZero = true } = {}) {
  let result;

  try {
    result = BigInt(value);
  } catch {
    throw financialError(`invalid_${name}`);
  }

  if (result < 0n || (!allowZero && result === 0n)) {
    throw financialError(`invalid_${name}`);
  }

  return result;
}

function basisPoints(value, name) {
  const result = integer(value, name);

  if (result > BPS_SCALE) {
    throw financialError(`invalid_${name}`);
  }

  return result;
}

function ceilDiv(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n) {
    throw financialError('invalid_ceiling_division');
  }

  return (numerator + denominator - 1n) / denominator;
}

function addBasisPointReserve(amount, reserveBps) {
  const reserve = basisPoints(reserveBps, 'reserve_bps');
  return ceilDiv(amount * (BPS_SCALE + reserve), BPS_SCALE);
}

function calculateCharge({ providerCostMicroUsd, policy }) {
  const providerCost = integer(
    providerCostMicroUsd,
    'provider_cost_micro_usd'
  );
  const creditValue = integer(
    policy.creditValueMicroUsd,
    'credit_value_micro_usd',
    { allowZero: false }
  );
  const minimumCredits = integer(
    policy.minimumChargeCredits,
    'minimum_charge_credits',
    { allowZero: false }
  );
  const providerReserve = basisPoints(
    policy.providerCostReserveBps,
    'provider_cost_reserve_bps'
  );
  const retryReserve = basisPoints(
    policy.retryFailureReserveBps,
    'retry_failure_reserve_bps'
  );
  const currencyReserve = basisPoints(
    policy.currencyChangeReserveBps,
    'currency_change_reserve_bps'
  );
  const targetMargin = basisPoints(
    policy.targetGrossMarginBps,
    'target_gross_margin_bps'
  );
  const infrastructureReserve = integer(
    policy.infrastructureReserveMicroUsd,
    'infrastructure_reserve_micro_usd'
  );

  if (targetMargin >= BPS_SCALE) {
    throw financialError('invalid_target_gross_margin_bps');
  }

  const combinedReserve =
    providerReserve + retryReserve + currencyReserve;

  if (combinedReserve > BPS_SCALE) {
    throw financialError('invalid_combined_reserve_bps');
  }

  const safeguardedProviderCost = addBasisPointReserve(
    providerCost,
    combinedReserve
  );
  const safeguardedCost =
    safeguardedProviderCost + infrastructureReserve;
  const minimumRevenue = ceilDiv(
    safeguardedCost * BPS_SCALE,
    BPS_SCALE - targetMargin
  );
  const calculatedCredits = ceilDiv(minimumRevenue, creditValue);
  const chargedCredits =
    calculatedCredits > minimumCredits
      ? calculatedCredits
      : minimumCredits;
  const revenue = chargedCredits * creditValue;
  const grossProfit = revenue - safeguardedCost;
  const grossMarginBps = revenue === 0n
    ? 0n
    : (grossProfit * BPS_SCALE) / revenue;

  if (grossMarginBps < targetMargin) {
    throw financialError('margin_floor_not_met');
  }

  return Object.freeze({
    providerCostMicroUsd: providerCost.toString(),
    safeguardedProviderCostMicroUsd:
      safeguardedProviderCost.toString(),
    infrastructureReserveMicroUsd:
      infrastructureReserve.toString(),
    safeguardedCostMicroUsd: safeguardedCost.toString(),
    minimumRevenueMicroUsd: minimumRevenue.toString(),
    chargedCredits: chargedCredits.toString(),
    revenueMicroUsd: revenue.toString(),
    grossProfitMicroUsd: grossProfit.toString(),
    grossMarginBps: grossMarginBps.toString(),
    targetGrossMarginBps: targetMargin.toString()
  });
}

module.exports = {
  BPS_SCALE,
  financialError,
  integer,
  basisPoints,
  ceilDiv,
  addBasisPointReserve,
  calculateCharge
};
