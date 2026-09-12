'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { plans } = require('./src/core/config');
const {
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
} = require('./lib/planEntitlements');
const {
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PRICE_ENV_KEYS,
  getSubscriptionPlan,
  getSubscriptionOffer
} = require('./lib/billingCatalog');

assert.equal(plans.version, 'pack-016.canonical-plans-entitlements.v1');
assert.equal(plans.defaultPlan, 'free');
assert.deepEqual(
  plans.planOrder,
  ['free', 'plus', 'pro', 'legend', 'max']
);
assert.deepEqual(
  plans.paidPlanOrder,
  ['plus', 'pro', 'legend', 'max']
);
assert.equal(DEFAULT_PLAN, 'free');
assert.deepEqual(PLAN_IDS, plans.planOrder);
assert.deepEqual(PAID_PLAN_IDS, plans.paidPlanOrder);
assert.deepEqual(SUBSCRIPTION_PLAN_IDS, plans.paidPlanOrder);

const expectedStripeKeys = {
  plus: 'STRIPE_PLUS_PRICE_ID',
  pro: 'STRIPE_PRO_PRICE_ID',
  legend: 'STRIPE_LEGEND_PRICE_ID',
  max: 'STRIPE_MAX_PRICE_ID'
};

assert.deepEqual(SUBSCRIPTION_PRICE_ENV_KEYS, expectedStripeKeys);

for (const planId of plans.planOrder) {
  const plan = getPlan(planId);

  assert.equal(plan.id, planId);
  assert.deepEqual(plan.features, plans.tiers[planId].features);

  if (planId === 'free') {
    assert.equal(plan.billing.subscriptionEligible, false);
    assert.equal(plan.billing.stripePriceEnvKey, null);
  } else {
    assert.equal(plan.billing.subscriptionEligible, true);
    assert.equal(
      plan.billing.stripePriceEnvKey,
      expectedStripeKeys[planId]
    );
  }
}

assert.equal(normalizePlanId(' PLUS '), 'plus');
assert.equal(normalizePlanId('unknown'), 'free');
assert.equal(normalizePlanId(null), 'free');

assert.equal(
  canonicalPlanIdFromProfile({
    subscription_status: 'legend',
    subscriptionStatus: 'pro',
    plan: 'plus'
  }),
  'legend'
);
assert.equal(
  canonicalPlanIdFromProfile({
    subscriptionStatus: 'max',
    plan: 'plus'
  }),
  'max'
);
assert.equal(canonicalPlanIdFromProfile({ plan: 'pro' }), 'pro');
assert.equal(canonicalPlanIdFromProfile({ subscription_status: 'bogus' }), 'free');
assert.equal(canonicalPlanIdFromProfile(null), 'free');

assert.equal(isPaidPlan('free'), false);
for (const planId of plans.paidPlanOrder) {
  assert.equal(isPaidPlan(planId), true);
  assert(getSubscriptionPlan(planId));
}
assert.equal(getSubscriptionPlan('free'), null);
assert.equal(getSubscriptionPlan('unknown'), null);

const env = {
  STRIPE_PLUS_PRICE_ID: 'price_plus',
  STRIPE_PRO_PRICE_ID: 'price_pro',
  STRIPE_LEGEND_PRICE_ID: 'price_legend',
  STRIPE_MAX_PRICE_ID: 'price_max'
};

for (const planId of plans.paidPlanOrder) {
  assert.equal(
    getSubscriptionOffer(planId, env).stripePriceId,
    env[expectedStripeKeys[planId]]
  );
}

assert.equal(planHasFeature('free', 'chat'), true);
assert.equal(planHasFeature('free', 'code'), false);
assert.equal(planHasFeature('plus', 'code'), true);
assert.equal(planHasFeature('pro', 'video'), true);
assert.equal(planHasFeature('legend', 'ip'), true);
assert.equal(planHasFeature('max', 'ip'), true);
assert.equal(minimumPlanForFeature('code'), 'plus');
assert.equal(minimumPlanForFeature('video'), 'pro');
assert.equal(minimumPlanForFeature('ip'), 'legend');

assert.deepEqual(
  getPlanEntitlements('plus'),
  {
    planId: 'plus',
    priority: 'standard',
    features: {
      chat: true,
      image: true,
      video: false,
      audio: true,
      code: true,
      ip: false
    }
  }
);

for (const planId of plans.paidPlanOrder) {
  assert.equal(
    plans.tiers[planId].usageUnitsPerWindow,
    null,
    planId + ' must stay unconfigured until Pack 017'
  );
}
assert.equal(plans.usagePolicy.usageUnitsStatus, 'pending_real_cost_measurement');
assert.equal(plans.usagePolicy.topupCreditsUnlockPlanFeatures, false);

const billingRaw = fs.readFileSync(
  path.join(__dirname, 'lib', 'billingCatalog.js'),
  'utf8'
);
const allowanceRaw = fs.readFileSync(
  path.join(__dirname, 'lib', 'allowanceEngine.js'),
  'utf8'
);

assert(billingRaw.includes('PAID_PLAN_IDS'));
assert(billingRaw.includes('stripePriceEnvKey'));
assert(!billingRaw.includes("plus: 'STRIPE_PLUS_PRICE_ID'"));
assert(!billingRaw.includes("pro: 'STRIPE_PRO_PRICE_ID'"));
assert(!billingRaw.includes("legend: 'STRIPE_LEGEND_PRICE_ID'"));
assert(!billingRaw.includes("max: 'STRIPE_MAX_PRICE_ID'"));

assert(allowanceRaw.includes('canonicalPlanIdFromProfile(profile)'));
assert(!allowanceRaw.includes("typeof profile.plan === 'string'"));

console.log('PASS: Pack 016 establishes plans.json as the canonical plan and entitlement contract');
console.log('PASS: Stripe plan bindings are derived from the canonical plan catalog, not duplicated');
console.log('PASS: subscription_status is the canonical profile plan identity with compatibility fallbacks');
console.log('PASS: Pack 017 allowance values remain intentionally unconfigured; no limits were invented');
console.log('DATABASE / STRIPE / MODEL / NETWORK CALLS: NONE');
