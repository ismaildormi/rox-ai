'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const tests = [
  'test-pack05-operations.js',
  'test-pack05-request-contract.js',
  'test-pack05-artifacts-jobs.js',
  'test-pack05-provider.js',
  'test-pack05-history.js',
  'test-pack05-wiring.js',
  'test-pack05-database-foundation.js',
  'test-conversation-generation-unit.js',
  'test-generation-server-memory-wiring.js',
  'test-generation-worker-memory-wiring.js',
  'test-frontend-generation-memory-wiring.js',
  'test-conversation-asset-update-wiring.js',
  'test-frontend-outputs-wiring.js',
  'test-pack04.js'
];

for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH || '' }
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`PASS: ${tests.length} Pack 05 cumulative and Video regression runners`);
console.log('NETWORK / DATABASE / STRIPE / PROVIDER CALLS: NONE');
