'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const tests = ['test-pack08-registry-costs.js','test-pack08-permissions.js','test-pack08-plans-actions.js','test-pack08-recovery-audit.js','test-pack08-wiring.js','test-pack08-database-foundation.js','test-pack08-no-execution.js','test-conversation-roxip-unit.js','test-roxip-routes-unit.js','test-roxip-server-wiring.js','test-frontend-roxip-memory-wiring.js','test-pack07.js'];
for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], { encoding: 'utf8', env: { PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH || '' } });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`PASS: ${tests.length} Pack 08 cumulative ZUVYR IP regression runners`);
console.log('EXTERNAL NETWORK / DEVICE / DATABASE / STRIPE / PROVIDER / SUBPROCESS CALLS: NONE');
