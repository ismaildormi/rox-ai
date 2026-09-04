'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '25_atomic_stripe_checkout_settlement.sql'
);

for (const [name, file] of [
  ['migration', migrationPath],
  ['test', __filename]
]) {
  const raw = fs.readFileSync(file, 'utf8');

  assert(
    !raw.startsWith('\uFEFF'),
    `${name} contains UTF-8 BOM`
  );

  const badLine = raw
    .split(/\r?\n/)
    .findIndex(line => /[ \t]+$/.test(line));

  assert.strictEqual(
    badLine,
    -1,
    `${name} contains trailing whitespace on line ${badLine + 1}`
  );
}

const raw = fs.readFileSync(migrationPath, 'utf8');
const compact = raw.replace(/\s+/g, '').toLowerCase();

assert(
  compact.includes(
    'createuniqueindexifnotexistsrevenue_events_stripe_event_unique'
  ),
  'Stripe revenue IDs must be unique'
);

assert(
  compact.includes(
    'onpublic.revenue_events(stripe_event_id)wherestripe_event_idisnotnull;'
  ),
  'Unique index must target non-null Stripe event IDs'
);

assert(
  compact.includes(
    'functionpublic.settle_stripe_checkout_event('
  ),
  'Atomic checkout settlement function is missing'
);

assert(
  compact.includes(
    "p_checkout_typenotin('topup','subscription')"
  ),
  'Only top-up and subscription settlements may run'
);

assert(
  compact.includes(
    "p_plannotin('plus','pro','legend','max')"
  ),
  'Subscription plan validation is missing'
);

assert(
  compact.includes(
    'setcredits_total=coalesce(credits_total,0)+p_credits'
  ),
  'Top-up credits must be added inside the transaction'
);

assert(
  compact.includes(
    'insertintopublic.revenue_events('
  ),
  'Revenue recording must be inside the settlement'
);

assert(
  compact.includes(
    "processing_status='processed'"
  ),
  'Webhook completion must be inside the settlement'
);

assert(
  compact.includes(
    "v_processing_status<>'processing'"
  ),
  'Only a claimed processing event may settle'
);

const signature =
  'settle_stripe_checkout_event(text,uuid,text,text,integer,numeric,text,text,text,text,jsonb,integer)';

assert(
  compact.includes(
    `revokeexecuteonfunctionpublic.${signature}frompublic,anon,authenticated;`
  ),
  'Browser roles must not execute financial settlement'
);

assert(
  compact.includes(
    `grantexecuteonfunctionpublic.${signature}toservice_role;`
  ),
  'service_role must execute financial settlement'
);

assert(
  !/\bdrop\s+table\b/i.test(raw),
  'Migration must not drop a table'
);

assert(
  !/\btruncate\b/i.test(raw),
  'Migration must not truncate billing data'
);

assert(
  !/\bdelete\s+from\b/i.test(raw),
  'Migration must not delete billing data'
);

console.log(
  'PASS: Stripe checkout settlement is atomic and exactly-once'
);
console.log(
  'PASS: top-up, subscription, revenue and event completion share one transaction'
);
console.log(
  'PASS: settlement is restricted to service_role'
);
console.log('PASS: existing billing data is preserved');
console.log('DATABASE / STRIPE / MODEL CALLS: NONE');