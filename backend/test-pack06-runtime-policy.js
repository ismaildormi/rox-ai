'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertRuntimeRequestAllowed, runtimeStatus } = require('./lib/codeRuntimePolicy');

for (const operation of ['terminal', 'run', 'dependencies', 'build', 'test', 'deploy']) {
  assert.throws(
    () => assertRuntimeRequestAllowed({ operation, confirmed: true, sandboxReady: true }),
    error => error.operation === operation && ['blocked_no_sandbox', 'blocked_explicit_confirmation'].includes(error.code)
  );
}
assert.deepEqual(runtimeStatus().allowedOperations, []);
assert.equal(runtimeStatus().executorConfigured, false);
const policy = fs.readFileSync(path.join(__dirname, 'lib/codeRuntimePolicy.js'), 'utf8');
assert(!policy.includes("require('node:child_process')"));
assert(!policy.includes('spawn('));
assert(!policy.includes('exec('));
console.log('PASS: Pack 06 Terminal, build, test and deploy remain non-executable');
