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

function normalizeTechnicalCostComponents(components = []) {
  if (!Array.isArray(components)) {
    throw financialError('invalid_technical_cost_components');
  }

  return components.map((component, index) => {
    if (!component || typeof component !== 'object') {
      throw financialError(`invalid_technical_cost_component_${index}`);
    }

    const kind = String(component.kind || '').trim();
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(kind)) {
      throw financialError(`invalid_technical_cost_component_kind_${index}`);
    }
    if (component.costKnown !== true) {
      throw financialError(`technical_cost_unknown_${kind}`);
    }
    if (component.verified !== true) {
      throw financialError(`technical_cost_unverified_${kind}`);
    }

    const amount = integer(
      component.microUsd,
      `technical_cost_${kind}_micro_usd`
    );

    return Object.freeze({
      kind,
      microUsd: amount.toString(),
      costKnown: true,
      verified: true,
      source: component.source == null ? null : String(component.source)
    });
  });
}

function sumTechnicalCostComponents(components = []) {
  const normalized = normalizeTechnicalCostComponents(components);
  const total = normalized.reduce(
    (sum, component) => sum + BigInt(component.microUsd),
    0n
  );

  return Object.freeze({
    components: normalized,
    totalMicroUsd: total.toString()
  });
}

function calculateCharge({
  providerCostMicroUsd,
  technicalCostComponents = [],
  policy
}) {
  const providerCost = integer(
    providerCostMicroUsd,
    'provider_cost_micro_usd'
  );
  const technical = sumTechnicalCostComponents(technicalCostComponents);
  const measuredTechnicalCost = BigInt(technical.totalMicroUsd);
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
  const rawTechnicalCost =
    providerCost + infrastructureReserve + measuredTechnicalCost;
  const safeguardedCost =
    safeguardedProviderCost +
    infrastructureReserve +
    measuredTechnicalCost;
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
    measuredTechnicalCostMicroUsd: measuredTechnicalCost.toString(),
    rawTechnicalCostMicroUsd: rawTechnicalCost.toString(),
    technicalCostComponents: technical.components,
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
  normalizeTechnicalCostComponents,
  sumTechnicalCostComponents,
  calculateCharge
};
