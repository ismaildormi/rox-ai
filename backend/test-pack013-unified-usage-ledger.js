'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const migration = path.join(__dirname, '44_pack013_unified_usage_ledger.sql');
assert(fs.existsSync(migration), 'Pack 013 migration is missing');

const raw = fs.readFileSync(migration);
const sha = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
assert.strictEqual(
  sha,
  '4FED4A0BEA15DB2BDF18836061CA710BF3169E9A3CB9397922179A2FA97105BA',
  'Pack 013 migration bytes changed after review'
);

const sql = raw.toString('utf8').replace(/\r\n/g, '\n');
const compact = sql.replace(/\s+/g, ' ').toLowerCase();

for (const term of [
  'zuvyr_usage_records',
  'request_id',
  'step_id',
  'task_id',
  'project_id',
  'credit_audit_log',
  'service_role'
]) {
  assert(compact.includes(term), `Unified ledger migration missing required contract marker: ${term}`);
}

for (const state of ['available', 'reserved', 'used', 'refunded']) {
  assert(
    compact.includes(state),
    `Unified ledger normalized accounting state missing: ${state}`
  );
}

assert(
  /revoke\s+(?:all|execute).*?(?:public|anon|authenticated)/s.test(compact),
  'Unified ledger mutation surface must remain unavailable to browser roles'
);

assert(
  /grant\s+execute.*?service_role/s.test(compact),
  'Unified ledger RPC execution must remain service-role-only'
);

for (const destructive of [
  'drop table',
  'truncate ',
  'delete from public.profiles',
  'delete from public.zuvyr_usage_records',
  'delete from public.credit_audit_log'
]) {
  assert(
    !compact.includes(destructive),
    `Pack 013 migration must not contain destructive operation: ${destructive}`
  );
}

assert(
  compact.includes('legacy') || compact.includes('credit_audit_log'),
  'Pack 013 must preserve compatibility with the legacy financial path'
);

const gatekeeperRaw = fs.readFileSync(path.join(__dirname, 'gatekeeper.js'), 'utf8').replace(/\r\n/g, '\n');
const gatekeeperCompact = gatekeeperRaw.replace(/\s+/g, ' ').toLowerCase();
for (const marker of ['p_metadata: ledgermetadata', 'project_id:', 'task_id:', 'step_id:', 'usage_kind:', "'ai_code_edit'", "'generation'", "'chat_request'"]) {
  assert(gatekeeperCompact.includes(marker), 'Pack 013 runtime ledger bridge missing: ' + marker);
}

for (const marker of ['pack013_historical_cross_ledger_conflict', 'pack013_duplicate_legacy_request_identity', 'pack013_historical_idempotency_conflict', 'settled_final_credits', 'on conflict (request_id) do nothing']) {
  assert(compact.includes(marker), 'Pack 013 historical reconciliation marker missing: ' + marker);
}

console.log(
  'PASS: Pack 013 unified usage ledger migration is immutable, correlated by request/task/step/project, normalized across accounting states, non-destructive and service-role-only'
);
