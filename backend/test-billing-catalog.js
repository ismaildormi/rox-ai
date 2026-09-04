'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PRICE_ENV_KEYS,
  getSubscriptionPlan,
  getStripePriceId,
  getSubscriptionOffer,
  missingSubscriptionPriceKeys
} = require('./lib/billingCatalog');

const expected = {
  plus: { price: 10, env: 'STRIPE_PLUS_PRICE_ID' },
  pro: { price: 20, env: 'STRIPE_PRO_PRICE_ID' },
  legend: { price: 50, env: 'STRIPE_LEGEND_PRICE_ID' },
  max: { price: 100, env: 'STRIPE_MAX_PRICE_ID' }
};

assert.deepStrictEqual(SUBSCRIPTION_PLAN_IDS, Object.keys(expected));
assert.deepStrictEqual(SUBSCRIPTION_PRICE_ENV_KEYS, {
  plus: 'STRIPE_PLUS_PRICE_ID',
  pro: 'STRIPE_PRO_PRICE_ID',
  legend: 'STRIPE_LEGEND_PRICE_ID',
  max: 'STRIPE_MAX_PRICE_ID'
});

for (const [planId, contract] of Object.entries(expected)) {
  const plan = getSubscriptionPlan(planId.toUpperCase());
  assert.strictEqual(plan.id, planId);
  assert.strictEqual(plan.monthlyPriceUsd, contract.price);
  assert.strictEqual(plan.priceEnvKey, contract.env);
  assert.strictEqual(typeof plan.features.chat, 'boolean');
}

assert.strictEqual(getSubscriptionPlan('free'), null);
assert.strictEqual(getSubscriptionPlan('unknown'), null);

const env = {
  STRIPE_PLUS_PRICE_ID: 'price_plus',
  STRIPE_PRO_PRICE_ID: 'price_pro',
  STRIPE_LEGEND_PRICE_ID: 'price_legend',
  STRIPE_MAX_PRICE_ID: 'price_max'
};

for (const planId of SUBSCRIPTION_PLAN_IDS) {
  assert.strictEqual(
    getStripePriceId(planId, env),
    env[expected[planId].env]
  );
  assert.strictEqual(
    getSubscriptionOffer(planId, env).stripePriceId,
    env[expected[planId].env]
  );
}

assert.deepStrictEqual(missingSubscriptionPriceKeys(env), []);
assert.deepStrictEqual(
  missingSubscriptionPriceKeys({ STRIPE_PRO_PRICE_ID: 'price_pro' }),
  [
    'STRIPE_PLUS_PRICE_ID',
    'STRIPE_LEGEND_PRICE_ID',
    'STRIPE_MAX_PRICE_ID'
  ]
);

for (const file of [
  path.join(__dirname, 'lib', 'billingCatalog.js'),
  __filename
]) {
  const raw = fs.readFileSync(file, 'utf8');
  assert(!raw.startsWith('\uFEFF'), `BOM found in ${file}`);
  assert(
    !raw.split(/\r?\n/).some(line => /[ \t]+$/.test(line)),
    `Trailing whitespace found in ${file}`
  );
}

console.log('PASS: Plus, Pro, Legend and Max map to exact prices and Stripe keys');
console.log('PASS: Free and unknown plans cannot create subscription offers');
console.log('PASS: missing Stripe price configuration is explicit');
console.log('DATABASE / STRIPE / MODEL CALLS: NONE');
