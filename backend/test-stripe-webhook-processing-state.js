'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '24_stripe_webhook_processing_state.sql'
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

for (const column of [
  'processing_status',
  'attempt_count',
  'processing_started_at',
  'completed_at',
  'last_error',
  'updated_at'
]) {
  assert(
    compact.includes(`addcolumnifnotexists${column}`),
    `Missing processing column: ${column}`
  );
}

assert(
  compact.includes(
    "processing_statustextnotnulldefault'processed'"
  ),
  'Legacy inserts must remain compatible and default to processed'
);

for (const status of [
  "'processing'",
  "'processed'",
  "'failed'"
]) {
  assert(
    compact.includes(status),
    `Missing processing status: ${status}`
  );
}

for (const fn of [
  'claim_stripe_webhook_event',
  'complete_stripe_webhook_event',
  'fail_stripe_webhook_event'
]) {
  assert(
    compact.includes(`functionpublic.${fn}(`),
    `Missing function: ${fn}`
  );
}

assert(
  compact.includes('onconflict(event_id)donothing;'),
  'Claims must be atomic and conflict-safe'
);

assert(
  compact.includes("interval'10minutes'"),
  'Stale processing claims must become retryable'
);

for (const action of [
  "'process'",
  "'duplicate'",
  "'in_progress'"
]) {
  assert(
    compact.includes(`'action',${action}`),
    `Missing claim action: ${action}`
  );
}

for (const signature of [
  'claim_stripe_webhook_event(text,text)',
  'complete_stripe_webhook_event(text)',
  'fail_stripe_webhook_event(text,text)'
]) {
  assert(
    compact.includes(
      `revokeexecuteonfunctionpublic.${signature}frompublic,anon,authenticated;`
    ),
    `Missing browser-role revoke for ${signature}`
  );

  assert(
    compact.includes(
      `grantexecuteonfunctionpublic.${signature}toservice_role;`
    ),
    `Missing service-role grant for ${signature}`
  );
}

assert(
  !/\bdrop\s+table\b/i.test(raw),
  'Migration must not drop webhook_events'
);

assert(
  !/\btruncate\b/i.test(raw),
  'Migration must not truncate webhook_events'
);

assert(
  !/\bdelete\s+from\s+public\.webhook_events\b/i.test(raw),
  'Migration must not delete stored events'
);

console.log(
  'PASS: Stripe events support atomic claim, completion, failure and retry'
);
console.log(
  'PASS: existing events and legacy webhook inserts remain processed'
);
console.log(
  'PASS: processing RPCs are restricted to service_role'
);
console.log('PASS: target files contain no BOM or trailing whitespace');
console.log('DATABASE / STRIPE / MODEL CALLS: NONE');