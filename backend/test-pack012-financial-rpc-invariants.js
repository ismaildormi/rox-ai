'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname)
  .filter(name => /^\d+_pack012_financial_rpc_invariants\.sql$/.test(name));

assert.strictEqual(
  files.length,
  1,
  'Exactly one Pack 012 financial invariant migration must exist.'
);

const sql = fs.readFileSync(
  path.join(__dirname, files[0]),
  'utf8'
).replace(/\r\n/g, '\n');

const compact = sql.replace(/\s+/g, ' ').toLowerCase();

assert(
  compact.includes('add column if not exists reserved_credits integer'),
  'Legacy audit rows must retain immutable reservation identity.'
);

assert(
  compact.includes('add column if not exists settled_final_credits integer'),
  'Legacy settlements must have a dedicated immutable final-credit marker.'
);

assert(
  compact.includes('p_credits_consumed is null or p_credits_consumed < 0'),
  'Legacy deduct must reject null/negative credit movement.'
);

assert(
  compact.includes("'request_id_required_for_charge'"),
  'A positive charge must require a bounded request id.'
);

assert(
  compact.includes("status in ('success', 'refunded')"),
  'Idempotency must see refunded requests as terminal financial identities.'
);

assert(
  compact.includes("'request_already_refunded'"),
  'A refunded request must never be charged again.'
);

assert(
  (compact.match(/pg_advisory_xact_lock/g) || []).length >= 3,
  'Charge, settle and refund must serialize by logical request id.'
);

assert(
  compact.includes('exception when unique_violation'),
  'Cross-user request-id collision must roll back the attempted debit.'
);

assert(
  compact.includes('p_final_credits is null or p_final_credits < 0'),
  'Settlement must reject null/negative final credits.'
);

assert(
  compact.includes('v_log.settled_final_credits is not null'),
  'Settlement replay must consult immutable settlement state.'
);

assert(
  compact.includes("'settlement_conflict'"),
  'A replay with different final credits must fail closed.'
);

assert(
  compact.includes("'settlement_balance_conflict'"),
  'Settlement must reject legacy balance underflow/overflow.'
);

assert(
  compact.includes("'refund_balance_conflict'"),
  'Refund must never push used credits below zero.'
);

for (const signature of [
  "public.deduct_credit_and_log(",
  "public.refund_credit_and_log(text)",
  "public.settle_credit_charge(text, integer)"
]) {
  assert(
    compact.includes(`revoke execute on function ${signature}`),
    `Client EXECUTE revoke missing for ${signature}`
  );
}

assert(
  compact.includes('to service_role'),
  'Financial RPC execution must remain service-role-only.'
);

for (const destructive of [
  'drop table',
  'truncate ',
  'delete from public.profiles',
  'delete from public.credit_audit_log'
]) {
  assert(
    !compact.includes(destructive),
    `Pack 012 migration must not contain destructive operation: ${destructive}`
  );
}

console.log(
  'PASS: Pack 012 legacy financial RPCs are request-serialized, replay-safe, immutable after settlement, refund-safe and service-role-only'
);
