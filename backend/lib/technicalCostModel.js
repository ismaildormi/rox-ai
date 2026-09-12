'use strict';

const policy = require('../config/technical-cost-policy.v1.json');
const {
  integer,
  calculateCharge
} = require('./exactMoney');

const COMPONENT_KINDS = new Set(policy.componentKinds);

function technicalCostError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requiredText(value, code, max = 200) {
  const text = String(value || '').trim();
  if (!text || text.length > max) throw technicalCostError(code);
  return text;
}

function normalizeComponent(component, index) {
  if (!component || typeof component !== 'object') {
    throw technicalCostError(`invalid_technical_component_${index}`);
  }

  const kind = requiredText(
    component.kind,
    `invalid_technical_component_kind_${index}`,
    64
  );

  if (!COMPONENT_KINDS.has(kind) || kind === 'provider' || kind === 'infrastructure') {
    throw technicalCostError(`unsupported_technical_component_${kind}`);
  }
  if (component.costKnown !== true) {
    throw technicalCostError(`technical_cost_unknown_${kind}`);
  }
  if (component.verified !== true) {
    throw technicalCostError(`technical_cost_unverified_${kind}`);
  }

  const microUsd = integer(
    component.microUsd,
    `technical_${kind}_micro_usd`
  ).toString();

  return Object.freeze({
    kind,
    microUsd,
    costKnown: true,
    verified: true,
    source: requiredText(
      component.source,
      `technical_cost_source_required_${kind}`,
      500
    ),
    measurement: component.measurement && typeof component.measurement === 'object'
      ? Object.freeze({ ...component.measurement })
      : null
  });
}

function buildTechnicalCostTrace({
  providerCostMicroUsd,
  infrastructureCostMicroUsd = '0',
  components = [],
  pricingVersion,
  basis = 'estimate'
} = {}) {
  const provider = integer(
    providerCostMicroUsd,
    'provider_cost_micro_usd'
  );
  const infrastructure = integer(
    infrastructureCostMicroUsd,
    'infrastructure_cost_micro_usd'
  );
  const normalizedBasis = String(basis || '').trim();
  if (!['estimate', 'actual', 'conservative_upper_bound'].includes(normalizedBasis)) {
    throw technicalCostError('invalid_technical_cost_basis');
  }
  const normalizedPricingVersion = requiredText(
    pricingVersion,
    'technical_cost_pricing_version_required',
    200
  );
  if (!Array.isArray(components)) {
    throw technicalCostError('invalid_technical_components');
  }

  const normalized = components.map(normalizeComponent);
  const overhead = normalized.reduce(
    (sum, component) => sum + BigInt(component.microUsd),
    0n
  );
  const total = provider + infrastructure + overhead;

  return Object.freeze({
    version: policy.version,
    pricingVersion: normalizedPricingVersion,
    currency: 'USD',
    amountUnit: 'micro_usd_integer_string',
    basis: normalizedBasis,
    costKnown: true,
    providerCostMicroUsd: provider.toString(),
    infrastructureCostMicroUsd: infrastructure.toString(),
    measuredOverheadMicroUsd: overhead.toString(),
    allInTechnicalCostMicroUsd: total.toString(),
    components: Object.freeze([
      Object.freeze({
        kind: 'provider',
        microUsd: provider.toString(),
        costKnown: true,
        verified: true,
        source: 'authoritative_cost_registry'
      }),
      Object.freeze({
        kind: 'infrastructure',
        microUsd: infrastructure.toString(),
        costKnown: true,
        verified: true,
        source: 'operator_economics_configuration'
      }),
      ...normalized
    ])
  });
}

function quoteTechnicalCost({
  providerCostMicroUsd,
  components = [],
  pricingVersion,
  basis = 'estimate',
  economics
} = {}) {
  if (!economics || typeof economics !== 'object') {
    throw technicalCostError('technical_cost_economics_required');
  }

  const infrastructure = integer(
    economics.infrastructureReserveMicroUsd,
    'infrastructure_reserve_micro_usd'
  ).toString();

  const trace = buildTechnicalCostTrace({
    providerCostMicroUsd,
    infrastructureCostMicroUsd: infrastructure,
    components,
    pricingVersion,
    basis
  });

  const charge = calculateCharge({
    providerCostMicroUsd,
    technicalCostComponents: components.map((component, index) => {
      const normalized = normalizeComponent(component, index);
      return {
        kind: normalized.kind,
        microUsd: normalized.microUsd,
        costKnown: true,
        verified: true,
        source: normalized.source
      };
    }),
    policy: economics
  });

  return Object.freeze({
    trace,
    charge,
    settlementAudit: Object.freeze({
      technicalCostModelVersion: policy.version,
      pricingVersion: trace.pricingVersion,
      costBasis: trace.basis,
      allInTechnicalCostMicroUsd: trace.allInTechnicalCostMicroUsd,
      safeguardedCostMicroUsd: charge.safeguardedCostMicroUsd,
      revenueMicroUsd: charge.revenueMicroUsd,
      grossProfitMicroUsd: charge.grossProfitMicroUsd,
      grossMarginBps: charge.grossMarginBps,
      components: trace.components
    })
  });
}

module.exports = {
  policy,
  COMPONENT_KINDS,
  buildTechnicalCostTrace,
  quoteTechnicalCost
};
