'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const tests = [
  'test-pack02-registry.js',
  'test-pack02-planner.js',
  'test-pack02-orchestration.js',
  'test-pack02-database-foundation.js',
  'test-pack02-wiring.js',
  'test-pack01.js',
  'test-zuvyr-groq-foundation.js'
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

console.log(`PASS: ${tests.length} Pack 02 cumulative and regression runners`);
console.log('NETWORK / DATABASE / STRIPE / PROVIDER CALLS: NONE');
