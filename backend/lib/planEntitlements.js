'use strict';

const { plans } = require('../src/core/config');

const DEFAULT_PLAN = 'free';
const PLAN_IDS = Object.freeze(
  Array.isArray(plans.planOrder)
    ? [...plans.planOrder]
    : Object.keys(plans.tiers || {})
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
  return {
    id,
    ...(plans.tiers[id] || plans.tiers[DEFAULT_PLAN])
  };
}

function isPaidPlan(value) {
  return normalizePlanId(value) !== DEFAULT_PLAN;
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

module.exports = {
  DEFAULT_PLAN,
  PLAN_IDS,
  normalizePlanId,
  getPlan,
  isPaidPlan,
  planHasFeature,
  minimumPlanForFeature
};
