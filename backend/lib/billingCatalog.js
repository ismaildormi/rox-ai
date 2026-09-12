'use strict';

const {
  PAID_PLAN_IDS,
  getPlan,
  normalizePlanId
} = require('./planEntitlements');

const SUBSCRIPTION_PLAN_IDS = Object.freeze([...PAID_PLAN_IDS]);

const SUBSCRIPTION_PRICE_ENV_KEYS = Object.freeze(
  Object.fromEntries(
    SUBSCRIPTION_PLAN_IDS.map(planId => {
      const plan = getPlan(planId);
      const key = plan.billing?.stripePriceEnvKey;

      if (
        plan.billing?.subscriptionEligible !== true ||
        typeof key !== 'string' ||
        !key.trim()
      ) {
        throw new Error(
          'Missing canonical Stripe price environment key for plan: ' + planId
        );
      }

      return [planId, key.trim()];
    })
  )
);

if (
  new Set(Object.values(SUBSCRIPTION_PRICE_ENV_KEYS)).size !==
  SUBSCRIPTION_PLAN_IDS.length
) {
  throw new Error('Canonical Stripe price environment keys must be unique.');
}

function getSubscriptionPlan(value) {
  const planId = normalizePlanId(value);

  if (!SUBSCRIPTION_PLAN_IDS.includes(planId)) {
    return null;
  }

  const plan = getPlan(planId);
  const monthlyPriceUsd = Number(plan.monthlyPriceUsd);
  const priceEnvKey = SUBSCRIPTION_PRICE_ENV_KEYS[planId];

  if (!Number.isFinite(monthlyPriceUsd) || monthlyPriceUsd <= 0) {
    throw new Error('Invalid monthly price for plan: ' + planId);
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

function getSubscriptionOfferByPriceId(value, env = process.env) {
  const priceId =
    typeof value === 'string'
      ? value.trim()
      : '';

  if (!priceId) return null;

  const matches = SUBSCRIPTION_PLAN_IDS
    .map(planId => getSubscriptionOffer(planId, env))
    .filter(offer => offer.stripePriceId === priceId);

  if (matches.length > 1) {
    throw new Error(
      'Stripe price ID maps to multiple subscription plans.'
    );
  }

  return matches[0] || null;
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
  getSubscriptionOfferByPriceId,
  missingSubscriptionPriceKeys
};
