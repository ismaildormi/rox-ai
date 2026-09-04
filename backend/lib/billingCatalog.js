'use strict';

const {
  getPlan,
  normalizePlanId
} = require('./planEntitlements');

const SUBSCRIPTION_PRICE_ENV_KEYS = Object.freeze({
  plus: 'STRIPE_PLUS_PRICE_ID',
  pro: 'STRIPE_PRO_PRICE_ID',
  legend: 'STRIPE_LEGEND_PRICE_ID',
  max: 'STRIPE_MAX_PRICE_ID'
});

const SUBSCRIPTION_PLAN_IDS = Object.freeze(
  Object.keys(SUBSCRIPTION_PRICE_ENV_KEYS)
);

function getSubscriptionPlan(value) {
  const planId = normalizePlanId(value);
  const priceEnvKey = SUBSCRIPTION_PRICE_ENV_KEYS[planId];

  if (!priceEnvKey) return null;

  const plan = getPlan(planId);
  const monthlyPriceUsd = Number(plan.monthlyPriceUsd);

  if (!Number.isFinite(monthlyPriceUsd) || monthlyPriceUsd <= 0) {
    throw new Error(`Invalid monthly price for plan: ${planId}`);
  }

  return Object.freeze({
    id: planId,
    monthlyPriceUsd,
    priority: plan.priority,
    features: Object.freeze({ ...(plan.features || {}) }),
    priceEnvKey
  });
}

function getStripePriceId(value, env = process.env) {
  const plan = getSubscriptionPlan(value);
  if (!plan) return null;

  const candidate = env[plan.priceEnvKey];
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : null;
}

function getSubscriptionOffer(value, env = process.env) {
  const plan = getSubscriptionPlan(value);
  if (!plan) return null;

  return Object.freeze({
    ...plan,
    stripePriceId: getStripePriceId(plan.id, env)
  });
}

function missingSubscriptionPriceKeys(env = process.env) {
  return SUBSCRIPTION_PLAN_IDS
    .map(planId => SUBSCRIPTION_PRICE_ENV_KEYS[planId])
    .filter(key => {
      const value = env[key];
      return typeof value !== 'string' || !value.trim();
    });
}

module.exports = {
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PRICE_ENV_KEYS,
  getSubscriptionPlan,
  getStripePriceId,
  getSubscriptionOffer,
  missingSubscriptionPriceKeys
};
