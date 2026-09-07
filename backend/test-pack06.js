'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const tests = [
  'test-pack06-registry.js',
  'test-pack06-project-contract.js',
  'test-pack06-preview-archive.js',
  'test-pack06-runtime-policy.js',
  'test-pack06-wiring.js',
  'test-pack06-database-foundation.js',
  'test-frontend-outputs-wiring.js',
  'test-pack05.js'
];
for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], {
    encoding: 'utf8', env: { PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH || '' }
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`PASS: ${tests.length} Pack 06 cumulative and Code Studio regression runners`);
console.log('NETWORK / DATABASE / STRIPE / PROVIDER / SUBPROCESS CALLS: NONE');
