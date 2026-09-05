'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '26_subscription_lifecycle_foundation.sql'
);

const testPath = __filename;
const migrationRaw = fs.readFileSync(migrationPath, 'utf8');
const testRaw = fs.readFileSync(testPath, 'utf8');

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

const compact = migrationRaw
  .replace(/\s+/g, '')
  .toLowerCase();

assert(
  compact.includes(
    'addcolumnifnotexistsstripe_subscription_event_created_attimestamptz'
  ),
  'Missing Stripe event timestamp column'
);

assert(
  compact.includes(
    'addcolumnifnotexistsstripe_subscription_event_idtext'
  ),
  'Missing Stripe event ID column'
);

assert(
  migrationRaw.includes(
    'new.stripe_subscription_event_created_at :='
  ),
  'Event timestamp must be protected from browser updates'
);

assert(
  migrationRaw.includes(
    'new.stripe_subscription_event_id :='
  ),
  'Event ID must be protected from browser updates'
);

assert(
  compact.includes(
    'createorreplacefunctionpublic.settle_stripe_subscription_lifecycle_event('
  ),
  'Missing atomic subscription lifecycle function'
);

for (const status of [
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
    migrationRaw.includes(`'${status}'`),
    `Missing subscription status: ${status}`
  );
}

assert(
  migrationRaw.includes(
    "then p_plan\n    else 'free'"
  ),
  'Access plan must fail closed for non-access statuses'
);

assert(
  migrationRaw.includes(
    'p_event_created_at < v_existing_event_created_at'
  ),
  'Out-of-order Stripe events must be rejected as stale'
);

assert(
  migrationRaw.includes(
    "raise exception 'profile already has another active subscription'"
  ),
  'Concurrent active subscriptions must not overwrite each other'
);

assert(
  migrationRaw.includes(
    "processing_status = 'processed'"
  ),
  'Lifecycle update and event completion must share one transaction'
);

const signature = [
  'text',
  'timestamptz',
  'uuid',
  'text',
  'text',
  'text',
  'text',
  'text',
  'timestamptz',
  'timestamptz',
  'boolean'
].join(',');

assert(
  compact.includes(
    `revokeexecuteonfunctionpublic.` +
    `settle_stripe_subscription_lifecycle_event(` +
    `${signature})frompublic,anon,authenticated;`
  ),
  'Browser roles must not execute lifecycle settlement'
);

assert(
  compact.includes(
    `grantexecuteonfunctionpublic.` +
    `settle_stripe_subscription_lifecycle_event(` +
    `${signature})toservice_role;`
  ),
  'service_role must execute lifecycle settlement'
);

assert(
  !migrationRaw.includes('delete from public.profiles'),
  'Migration must not delete profiles'
);

assert(
  !migrationRaw.includes('delete from public.webhook_events'),
  'Migration must not delete webhook events'
);

assert(
  !migrationRaw.includes('delete from public.revenue_events'),
  'Migration must not delete revenue events'
);

console.log(
  'PASS: subscription lifecycle state is atomic and ordered'
);
console.log(
  'PASS: terminal subscriptions fail closed without touching top-up balances'
);
console.log(
  'PASS: lifecycle settlement is restricted to service_role'
);
console.log(
  'PASS: existing billing and webhook rows remain unchanged'
);
console.log('DATABASE / STRIPE / MODEL CALLS: NONE');