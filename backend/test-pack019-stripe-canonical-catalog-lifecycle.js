'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const plans =
  require('./config/plans.json');
const {
  stripeCatalog,
  canonicalStripeCatalogActive,
  subscriptionCatalog,
  topupTierForCredits,
  quoteTopupCredits,
  requiredPriceBindings,
  catalogBindingState,
  publicStripeCatalog
} = require('./lib/stripeCanonicalCatalog');

assert.equal(
  stripeCatalog.version,
  'pack-019.stripe-canonical-catalog.v1'
);
assert.equal(
  stripeCatalog.secretsEmbedded,
  false
);
assert.equal(
  stripeCatalog.externalGate,
  'M08'
);

const subscriptions =
  subscriptionCatalog();

assert.deepEqual(
  subscriptions.map(
    item => item.planId
  ),
  ['plus', 'pro', 'legend', 'max']
);

for (const item of subscriptions) {
  const plan =
    plans.tiers[item.planId];

  assert.equal(
    item.monthlyPriceUsd,
    plan.monthlyPriceUsd
  );
  assert.equal(
    item.priceEnvKey,
    plan.billing.stripePriceEnvKey
  );
  assert.equal(
    item.interval,
    'month'
  );
}

assert.equal(
  subscriptions.some(
    item =>
      item.planId === 'starter'
  ),
  false
);

assert.equal(
  topupTierForCredits(999),
  null
);
assert.equal(
  topupTierForCredits(1000).id,
  'standard'
);
assert.equal(
  topupTierForCredits(4999).id,
  'standard'
);
assert.equal(
  topupTierForCredits(5000).id,
  'bulk'
);
assert.equal(
  topupTierForCredits(10000).id,
  'bulk'
);
assert.equal(
  topupTierForCredits(10001),
  null
);

let quote =
  quoteTopupCredits(
    1000,
    {}
  );

assert.equal(
  quote.unitPriceMicrousd,
  10000
);
assert.equal(
  quote.amountCents,
  1000
);
assert.equal(
  quote.priceUsd,
  10
);

quote =
  quoteTopupCredits(
    5000,
    {}
  );

assert.equal(
  quote.unitPriceMicrousd,
  8000
);
assert.equal(
  quote.amountCents,
  4000
);
assert.equal(
  quote.priceUsd,
  40
);

quote =
  quoteTopupCredits(
    10000,
    {}
  );

assert.equal(
  quote.amountCents,
  8000
);
assert.equal(
  quote.priceUsd,
  80
);

const env = {
  ZUVYR_STRIPE_CANONICAL_CATALOG_ACTIVE:
    'true',
  STRIPE_PLUS_PRICE_ID:
    'price_plus_test',
  STRIPE_PRO_PRICE_ID:
    'price_pro_test',
  STRIPE_LEGEND_PRICE_ID:
    'price_legend_test',
  STRIPE_MAX_PRICE_ID:
    'price_max_test',
  STRIPE_TOPUP_STANDARD_PRICE_ID:
    'price_topup_standard_test',
  STRIPE_TOPUP_BULK_PRICE_ID:
    'price_topup_bulk_test'
};

assert.equal(
  canonicalStripeCatalogActive(env),
  true
);

const bindings =
  catalogBindingState(env);

assert.equal(
  bindings.allPriceBindingsConfigured,
  true
);

assert.equal(
  requiredPriceBindings().length,
  6
);

const publicCatalog =
  publicStripeCatalog(env);
const serialized =
  JSON.stringify(publicCatalog);

assert.equal(
  publicCatalog.allPriceBindingsConfigured,
  true
);
assert.equal(
  publicCatalog.canonicalModeActive,
  true
);

for (const forbidden of [
  'price_plus_test',
  'price_topup_standard_test',
  'price_topup_bulk_test'
]) {
  assert.equal(
    serialized.includes(forbidden),
    false,
    `public catalog leaked ${forbidden}`
  );
}

const configRaw =
  fs.readFileSync(
    path.join(
      __dirname,
      'config',
      'stripe-catalog.v1.json'
    ),
    'utf8'
  );

assert.equal(
  /sk_(?:live|test)_/i.test(
    configRaw
  ),
  false
);
assert.equal(
  /whsec_/i.test(configRaw),
  false
);
const parsedConfig =
  JSON.parse(configRaw);

function collectStringValues(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, out);
    }
    return out;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectStringValues(item, out);
    }
  }

  return out;
}

assert.equal(
  collectStringValues(parsedConfig)
    .some(value =>
      /^price_[A-Za-z0-9]/.test(value)
    ),
  false
);

const checkoutRaw =
  fs.readFileSync(
    path.join(
      __dirname,
      'createCheckoutSession.js'
    ),
    'utf8'
  );

assert(
  checkoutRaw.includes(
    "getSubscriptionOffer"
  )
);
assert(
  checkoutRaw.includes(
    "metadata: subscriptionMetadata"
  )
);

const webhookRaw =
  fs.readFileSync(
    path.join(
      __dirname,
      'stripeWebhook.js'
    ),
    'utf8'
  );

for (const marker of [
  'claim_stripe_webhook_event',
  'settle_stripe_checkout_event',
  'settle_stripe_subscription_lifecycle_event',
  'settle_stripe_subscription_invoice_event',
  "'invoice.paid'",
  "'invoice.payment_failed'",
  "'customer.subscription.updated'",
  "'customer.subscription.deleted'",
  "'customer.subscription.paused'"
]) {
  assert(
    webhookRaw.includes(marker),
    `Stripe lifecycle source missing ${marker}`
  );
}

console.log(
  'PASS: Pack019 canonical Stripe catalog derives subscription price bindings from plans.json'
);
console.log(
  'PASS: canonical top-up tiers preserve 1000=$10, 5000+ bulk economics and 10,000-credit cap using exact micro-USD'
);
console.log(
  'PASS: catalog stores only environment binding names and leaks no Stripe IDs or secrets'
);
console.log(
  'PASS: checkout/webhook source remains bound to atomic checkout, subscription and invoice settlement paths'
);
console.log(
  'EXTERNAL GATE M08 REMAINS REQUIRED; NETWORK / DATABASE / STRIPE / MODEL CALLS: NONE'
);
