'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '21_billing_rpc_permission_lockdown.sql'
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

const signatures = [
  'add_topup_credits(uuid,integer)',
  'deduct_credit_and_log(uuid,text,text,boolean,integer,text,text,text,jsonb)',
  'refund_credit_and_log(text)',
  'settle_credit_charge(text,integer)'
];

for (const signature of signatures) {
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

assert.strictEqual(
  (compact.match(/frompublic,anon,authenticated;/g) || []).length,
  signatures.length
);

assert.strictEqual(
  (compact.match(/toservice_role;/g) || []).length,
  signatures.length
);

assert(compact.includes('begin;'), 'Migration must start a transaction');
assert(compact.includes('commit;'), 'Migration must commit its transaction');

console.log(
  'PASS: financial RPCs deny PUBLIC/anon/authenticated and allow service_role'
);
console.log('PASS: target files contain no BOM or trailing whitespace');
console.log('DATABASE / STRIPE / MODEL CALLS: NONE');