'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '23_webhook_events_security.sql'
);

const files = [
  ['migration', migrationPath],
  ['test', __filename]
];

for (const [name, file] of files) {
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
  compact.includes('begin;'),
  'Migration must begin a transaction'
);

assert(
  compact.includes(
    'altertablepublic.webhook_eventsenablerowlevelsecurity;'
  ),
  'RLS must remain enabled'
);

assert(
  compact.includes(
    'revokeallprivilegesontablepublic.webhook_eventsfrompublic,anon,authenticated;'
  ),
  'Browser roles must lose all direct table privileges'
);

assert(
  compact.includes(
    'grantselect,insert,update,deleteontablepublic.webhook_eventstoservice_role;'
  ),
  'service_role must retain backend access'
);

assert(
  compact.includes('commit;'),
  'Migration must commit its transaction'
);

assert(
  !/\b(drop|truncate)\b/i.test(raw),
  'Migration must not delete the table or its stored events'
);

console.log(
  'PASS: webhook_events denies browser roles and allows service_role'
);
console.log('PASS: migration preserves existing webhook event rows');
console.log('PASS: target files contain no BOM or trailing whitespace');
console.log('DATABASE / STRIPE / MODEL CALLS: NONE');