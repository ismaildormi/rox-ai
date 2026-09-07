'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const tests = [
  'test-pack03-sources.js',
  'test-pack03-capabilities.js',
  'test-pack03-external-engines.js',
  'test-pack03-wiring.js',
  'test-pack03-database-foundation.js',
  'test-conversation-turn-unit.js',
  'test-conversation-attachment-context-unit.js',
  'test-conversation-attachment-retrieval-unit.js',
  'test-attachment-extraction-unit.js',
  'test-attachment-worker-unit.js',
  'test-chat-memory-wiring.js',
  'test-multimodal-chat-wiring.js',
  'test-frontend-chat-memory-wiring.js',
  'test-frontend-attachment-upload-wiring.js',
  'test-pack02.js'
];
for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], { encoding: 'utf8', env: { PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH || '' } });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`PASS: ${tests.length} Pack 03 cumulative and Chat regression runners`);
console.log('NETWORK / DATABASE / STRIPE / PROVIDER CALLS: NONE');
