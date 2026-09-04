'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '22_zuvyr_billing_database_foundation.sql'
);

const plansPath = path.join(
  __dirname,
  'config',
  'plans.json'
);

const migrationRaw = fs.readFileSync(migrationPath, 'utf8');
const testRaw = fs.readFileSync(__filename, 'utf8');
const plans = JSON.parse(fs.readFileSync(plansPath, 'utf8'));

for (const [name, raw] of [
  ['migration', migrationRaw],
  ['test', testRaw]
]) {
  assert(!raw.startsWith('\uFEFF'), `${name} contains UTF-8 BOM`);

  const badLine = raw
    .split(/\r?\n/)
    .findIndex(line => /[ \t]+$/.test(line));

  assert.strictEqual(
    badLine,
    -1,
    `${name} contains trailing whitespace on line ${badLine + 1}`
  );
}

assert.deepStrictEqual(
  plans.planOrder,
  ['free', 'plus', 'pro', 'legend', 'max']
);

assert.strictEqual(plans.usagePolicy.windowHours, 5);
assert.strictEqual(plans.usagePolicy.topupCreditsEnabled, true);
assert.strictEqual(
  plans.usagePolicy.topupCreditsExpireWithWindow,
  false
);
assert.strictEqual(
  plans.usagePolicy.topupCreditsUnlockPlanFeatures,
  false
);

const compact = migrationRaw
  .replace(/\s+/g, '')
  .toLowerCase();

const requiredColumns = [
  'billing_status',
  'stripe_customer_id',
  'stripe_subscription_id',
  'stripe_price_id',
  'subscription_current_period_start',
  'subscription_current_period_end',
  'subscription_cancel_at_period_end',
  'usage_window_started_at',
  'usage_window_ends_at',
  'usage_units_total',
  'usage_units_used',
  'topup_credits_balance',
  'billing_updated_at'
];

for (const column of requiredColumns) {
  assert(
    compact.includes(`addcolumnifnotexists${column}`),
    `Missing additive profile column: ${column}`
  );

  assert(
    compact.includes(`new.${column}:=old.${column};`),
    `Sensitive column is not protected: ${column}`
  );
}

for (const plan of ['free', 'plus', 'pro', 'legend', 'max']) {
  assert(
    compact.includes(`'${plan}'`),
    `Missing allowed plan: ${plan}`
  );
}

for (const status of [
  'inactive',
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'paused',
  'canceled',
  'incomplete',
  'incomplete_expired'
]) {
  assert(
    compact.includes(`'${status}'`),
    `Missing billing status: ${status}`
  );
}

assert(
  compact.includes(
    'createuniqueindexifnotexistsprofiles_zuvyr_stripe_customer_unique'
  )
);

assert(
  compact.includes(
    'createuniqueindexifnotexistsprofiles_zuvyr_stripe_subscription_unique'
  )
);

assert(
  compact.includes(
    'revokeeexecuteonfunctionpublic.protect_sensitive_profile_columns()'
  ) === false,
  'Invalid revoke syntax detected'
);

assert(
  compact.includes(
    'revokeexecuteonfunctionpublic.protect_sensitive_profile_columns()frompublic,anon,authenticated;'
  ),
  'Browser roles must not execute the protection function'
);

assert(
  compact.includes(
    'grantexecuteonfunctionpublic.protect_sensitive_profile_columns()toservice_role;'
  ),
  'Service role must retain access'
);

const forbiddenDataChanges = [
  'updatepublic.profilesset',
  'deletefrompublic.profiles',
  'truncatepublic.profiles',
  'dropcolumn'
];

for (const forbidden of forbiddenDataChanges) {
  assert(
    !compact.includes(forbidden),
    `Migration contains forbidden existing-data change: ${forbidden}`
  );
}

console.log(
  'PASS: five plans, Stripe state, five-hour window and persistent top-up wallet'
);
console.log(
  'PASS: existing balances remain untouched and new billing fields are protected'
);
console.log('DATABASE / STRIPE / MODEL CALLS: NONE');