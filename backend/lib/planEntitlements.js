'use strict';

const { plans } = require('../src/core/config');

const DEFAULT_PLAN =
  typeof plans.defaultPlan === 'string' &&
  plans.defaultPlan.trim()
    ? plans.defaultPlan.trim().toLowerCase()
    : 'free';

const PLAN_IDS = Object.freeze(
  Array.isArray(plans.planOrder)
    ? [...plans.planOrder]
    : Object.keys(plans.tiers || {})
);

const PAID_PLAN_IDS = Object.freeze(
  Array.isArray(plans.paidPlanOrder)
    ? plans.paidPlanOrder.filter(planId => PLAN_IDS.includes(planId))
    : PLAN_IDS.filter(planId =>
        plans.tiers?.[planId]?.billing?.subscriptionEligible === true
      )
);

function normalizePlanId(value) {
  const candidate =
    typeof value === 'string'
      ? value.trim().toLowerCase()
      : '';

  if (
    candidate &&
    Object.prototype.hasOwnProperty.call(
      plans.tiers || {},
      candidate
    )
  ) {
    return candidate;
  }

  return DEFAULT_PLAN;
}

function getPlan(value) {
  const id = normalizePlanId(value);
  const source = plans.tiers[id] || plans.tiers[DEFAULT_PLAN];

  return Object.freeze({
    id,
    ...source,
    features: Object.freeze({ ...(source.features || {}) }),
    billing: Object.freeze({ ...(source.billing || {}) })
  });
}

function isPaidPlan(value) {
  return PAID_PLAN_IDS.includes(normalizePlanId(value));
}

function canonicalPlanIdFromProfile(profile) {
  if (typeof profile === 'string') {
    return normalizePlanId(profile);
  }

  if (!profile || typeof profile !== 'object') {
    return DEFAULT_PLAN;
  }

  for (const candidate of [
    profile.subscription_status,
    profile.subscriptionStatus,
    profile.plan
  ]) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return normalizePlanId(candidate);
    }
  }

  return DEFAULT_PLAN;
}

function planHasFeature(value, feature) {
  if (typeof feature !== 'string' || !feature.trim()) {
    return false;
  }

  const plan = getPlan(value);
  return plan.features?.[feature.trim()] === true;
}

function minimumPlanForFeature(feature) {
  return (
    PLAN_IDS.find(planId =>
      planHasFeature(planId, feature)
    ) || null
  );
}

function getPlanEntitlements(value) {
  const plan = getPlan(value);

  return Object.freeze({
    planId: plan.id,
    priority: plan.priority || 'standard',
    features: Object.freeze({ ...(plan.features || {}) })
  });
}

module.exports = {
  DEFAULT_PLAN,
  PLAN_IDS,
  PAID_PLAN_IDS,
  normalizePlanId,
  canonicalPlanIdFromProfile,
  getPlan,
  getPlanEntitlements,
  isPaidPlan,
  planHasFeature,
  minimumPlanForFeature
};
