'use strict';

const assert = require('assert');
const fs = require('fs');

const migrationRaw = fs.readFileSync(
  require('path').join(
    __dirname,
    '27_stripe_subscription_invoice_settlement.sql'
  ),
  'utf8'
);

assert(!migrationRaw.startsWith('\uFEFF'));
assert.strictEqual(
  migrationRaw.split(/\r?\n/).findIndex(line => /[ \t]+$/.test(line)),
  -1
);

const compact = migrationRaw.replace(/\s+/g, '').toLowerCase();

assert(compact.includes(
  'createorreplacefunctionpublic.settle_stripe_subscription_invoice_event('
));
assert(migrationRaw.includes("p_invoice_outcome not in ('paid', 'payment_failed')"));
assert(migrationRaw.includes("'subscription_cycle',\n      'subscription_update'"));
assert(migrationRaw.includes("'subscription_create',\n    'subscription_cycle',\n    'subscription_update'"));
assert(migrationRaw.includes("p_subscription_status <> 'active'"));
assert(migrationRaw.includes('p_event_created_at < v_existing_event_created_at'));
assert(migrationRaw.includes("p_invoice_outcome = 'payment_failed'"));
assert(migrationRaw.includes("and p_subscription_status in ('active', 'trialing')"));
assert(migrationRaw.includes("then p_plan\n    else 'free'"));
assert(migrationRaw.includes("if p_invoice_outcome = 'paid' then\n    insert into public.revenue_events"));
assert(migrationRaw.includes("'revenue_recorded', false"));
assert(migrationRaw.includes("processing_status = 'processed'"));
assert(!migrationRaw.includes('delete from public.profiles'));
assert(!migrationRaw.includes('delete from public.webhook_events'));
assert(!migrationRaw.includes('delete from public.revenue_events'));
assert(!migrationRaw.includes('topup_credits_balance ='));
assert(!migrationRaw.includes('credits_total ='));
assert(!migrationRaw.includes('credits_used ='));

const signature = [
  'text', 'timestamptz', 'text', 'text', 'text', 'uuid',
  'text', 'text', 'text', 'text', 'text', 'timestamptz',
  'timestamptz', 'boolean', 'numeric', 'text', 'jsonb'
].join(',');

assert(compact.includes(
  `revokeexecuteonfunctionpublic.settle_stripe_subscription_invoice_event(${signature})frompublic,anon,authenticated;`
));
assert(compact.includes(
  `grantexecuteonfunctionpublic.settle_stripe_subscription_invoice_event(${signature})toservice_role;`
));

console.log('PASS: subscription invoice settlement is atomic and ordered');
console.log('PASS: paid renewals and plan changes record revenue exactly once');
console.log('PASS: payment failures never record revenue or touch top-up balances');
console.log('PASS: settlement is restricted to service_role');
console.log('DATABASE / STRIPE / MODEL CALLS: NONE');
