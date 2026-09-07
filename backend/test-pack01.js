'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const tests = [
  'test-pack01-economics.js',
  'test-pack01-allowances.js',
  'test-pack01-contract.js',
  'test-pack01-database-foundation.js',
  'test-billing-catalog.js',
  'test-plan-entitlements.js',
  'test-gatekeeper-unit.js',
  'test-billing-rpc-permissions.js',
  'test-zuvyr-billing-database-foundation.js',
  'test-atomic-stripe-checkout-settlement.js',
  'test-stripe-webhook-processing-state.js',
  'test-subscription-lifecycle-foundation.js',
  'test-stripe-subscription-invoice-settlement.js',
  'test-launch-blockers.js',
  'test-runtime-safety.js'
];

for (const test of tests) {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, test)],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        NODE_PATH: process.env.NODE_PATH || ''
      }
    }
  );

  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log(`PASS: ${tests.length} Pack 01 and regression test files`);
