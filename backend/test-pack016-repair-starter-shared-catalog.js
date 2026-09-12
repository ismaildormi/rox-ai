'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { plans } = require('./src/core/config');
const {
  PLAN_IDS,
  PAID_PLAN_IDS,
  getPlan,
  publicPlanCatalog,
  planHasFeature
} = require('./lib/planEntitlements');
const {
  SUBSCRIPTION_PLAN_IDS,
  getSubscriptionPlan
} = require('./lib/billingCatalog');

assert.equal(
  plans.version,
  'pack-016.canonical-plans-entitlements.v2'
);
assert.deepEqual(
  plans.planOrder,
  ['free', 'starter', 'plus', 'pro', 'legend', 'max']
);
assert.deepEqual(PLAN_IDS, plans.planOrder);
assert.deepEqual(
  PAID_PLAN_IDS,
  ['plus', 'pro', 'legend', 'max']
);
assert.deepEqual(
  SUBSCRIPTION_PLAN_IDS,
  ['plus', 'pro', 'legend', 'max']
);

const starter = getPlan('starter');

assert.equal(starter.id, 'starter');
assert.equal(starter.monthlyPriceUsd, null);
assert.equal(starter.usageUnitsPerWindow, null);
assert.equal(starter.entitlementStatus, 'pending_economics');
assert.equal(starter.billing.subscriptionEligible, false);
assert.equal(starter.billing.stripePriceEnvKey, null);

for (const feature of [
  'chat',
  'image',
  'video',
  'audio',
  'code',
  'ip'
]) {
  assert.equal(
    planHasFeature('starter', feature),
    false,
    'STARTER must fail closed until its economics/entitlements are explicitly verified'
  );
}

assert.equal(getSubscriptionPlan('starter'), null);
assert.equal(
  plans.entitlementPolicy.topupCreditsUnlockPlanFeatures,
  false
);

const catalog = publicPlanCatalog();

assert.equal(
  catalog.version,
  'pack-016.canonical-plans-entitlements.v2'
);
assert.deepEqual(
  catalog.planOrder,
  ['free', 'starter', 'plus', 'pro', 'legend', 'max']
);
assert.equal(catalog.tiers.starter.monthlyPriceUsd, null);
assert.equal(
  catalog.tiers.starter.entitlementStatus,
  'pending_economics'
);
assert.equal(
  catalog.tiers.starter.subscriptionEligible,
  false
);
assert.equal(
  catalog.topupCreditsUnlockPlanFeatures,
  false
);

for (const plan of Object.values(catalog.tiers)) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      plan,
      'stripePriceEnvKey'
    ),
    false,
    'public catalog must not expose environment-variable names'
  );
}

const server = fs.readFileSync(
  path.join(__dirname, 'server.js'),
  'utf8'
);
const frontend = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'index.html'),
  'utf8'
);

assert(
  server.includes("app.get('/api/plan-catalog'")
);
assert(
  server.includes('publicPlanCatalog()')
);

const frontendCatalogFetches =
  frontend.match(/authFetch\('\/api\/plan-catalog'/g) || [];

assert(
  frontendCatalogFetches.length >= 1,
  'frontend must read the backend canonical plan catalog'
);
assert(
  frontend.includes('zuvyrPlanCatalog'),
  'frontend must retain the canonical plan catalog'
);

assert.equal(
  fs.existsSync(
    path.join(
      __dirname,
      '45_pack016_starter_plan.sql'
    )
  ),
  false,
  'STARTER must not be activated in DB before economics and billing lifecycle are verified'
);

console.log(
  'PASS: Pack 016 FIX1 restores the canonical FREE/STARTER/PLUS/PRO/LEGEND/MAX catalog'
);
console.log(
  'PASS: STARTER exists fail-closed with no invented price, capacity, Stripe binding or feature access'
);
console.log(
  'PASS: backend exposes a sanitized canonical catalog and frontend reads that same runtime source'
);
console.log(
  'PASS: purchased credits still cannot unlock gated plan features'
);
console.log(
  'DATABASE / STRIPE / MODEL / NETWORK CALLS: NONE'
);
