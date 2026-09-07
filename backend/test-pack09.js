'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const tests = ['test-pack09-registry-costs.js','test-pack09-contracts.js','test-pack09-workflows-schedules.js','test-pack09-integrations.js','test-pack09-wiring.js','test-pack09-database-foundation.js','test-pack09-no-execution.js','test-pack08.js'];
for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], { encoding: 'utf8', env: { PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH || '' } });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`PASS: ${tests.length} Pack 09 cumulative Workspace regression runners`);
console.log('EXTERNAL NETWORK / STORAGE / SCHEDULE / WORKFLOW / PLUGIN / DRIVE / DATABASE / STRIPE / PROVIDER / SUBPROCESS CALLS: NONE');
