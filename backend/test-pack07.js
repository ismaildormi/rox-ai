'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const tests = [
  'test-pack07-operations-costs.js',
  'test-pack07-request-contract.js',
  'test-pack07-artifacts-jobs.js',
  'test-pack07-voice-privacy.js',
  'test-pack07-wiring.js',
  'test-pack07-database-foundation.js',
  'test-pack07-no-execution.js',
  'test-conversation-attachments-unit.js',
  'test-conversation-attachment-context-unit.js',
  'test-frontend-outputs-wiring.js',
  'test-pack06.js'
];
for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], {
    encoding: 'utf8', env: { PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH || '' }
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`PASS: ${tests.length} Pack 07 cumulative Voice/Music/Audio regression runners`);
console.log('NETWORK / DATABASE / STRIPE / PROVIDER / SUBPROCESS CALLS: NONE');
