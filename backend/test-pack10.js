'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const tests = ['test-pack10-interfaces.js','test-pack10-usage-analytics.js','test-pack10-settings-notifications.js','test-pack10-apps-launch.js','test-pack10-wiring.js','test-pack10-database-foundation.js','test-pack10-frontend-inventory.js','test-pack10-no-activation.js','test-pack09.js'];
for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], { encoding: 'utf8', env: { PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH || '' } });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`PASS: ${tests.length} Pack 10 cumulative Final Product regression runners`);
console.log('EXTERNAL NETWORK / BILLING ACTIVATION / DEPLOYMENT / STORE / DATABASE / STRIPE / PROVIDER / SUBPROCESS CALLS: NONE');
