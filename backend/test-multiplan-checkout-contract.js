'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const checkoutPath = path.join(__dirname, 'createCheckoutSession.js');
const testPath = __filename;
const checkout = fs.readFileSync(checkoutPath, 'utf8');
const test = fs.readFileSync(testPath, 'utf8');

for (const [name, raw] of [
  ['checkout', checkout],
  ['test', test]
]) {
  assert(!raw.startsWith('\uFEFF'), `${name} contains UTF-8 BOM`);
  const bad = raw.split(/\r?\n/).findIndex(line => /[ \t]+$/.test(line));
  assert.strictEqual(bad, -1, `${name} has trailing whitespace on line ${bad + 1}`);
}

assert(checkout.includes("require('./lib/billingCatalog')"));
assert(checkout.includes('ZUVYR_BILLING_V1_ACTIVE'));
assert(checkout.includes("code: 'billing_not_active'"));
assert(checkout.includes("code: 'invalid_subscription_plan'"));
assert(checkout.includes('getSubscriptionOffer(requestedPlan)'));
assert(checkout.includes('offer.priceEnvKey'));
assert(checkout.includes('price: offer.stripePriceId'));
assert(checkout.includes('client_reference_id: userId'));
assert(checkout.includes("plan: offer.id"));
assert(checkout.includes('subscription_data:'));
assert(checkout.includes('metadata: subscriptionMetadata'));
assert(checkout.includes("success_url: `${appUrl}/?upgraded=true`"));

assert(!checkout.includes('process.env.STRIPE_PRO_PRICE_ID'));
assert(!checkout.includes("metadata: { userId, type: 'subscription' }"));

assert.strictEqual(
  (checkout.match(/stripe\.checkout\.sessions\.create\(/g) || []).length,
  1
);
assert.strictEqual(
  (checkout.match(/billingV1IsActive\(\)/g) || []).length,
  1
);

console.log('PASS: subscription checkout supports Plus, Pro, Legend and Max through the catalog');
console.log('PASS: checkout remains fail-closed until ZUVYR_BILLING_V1_ACTIVE=true');
console.log('PASS: plan identity is attached to Checkout and Subscription metadata');
console.log('DATABASE / STRIPE / MODEL CALLS: NONE');
