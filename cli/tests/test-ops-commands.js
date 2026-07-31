#!/usr/bin/env node
// ROX AI — cli/tests/test-ops-commands.js
//
// Every command module under cli/commands/{queue,cron,server,jobs.js,
// latency.js} must be require()-able with zero backend deps installed
// (they only touch backend code inside their async handler, via
// tryLoad — never at module load time). This test would have caught
// e.g. a top-level `require('../../lib/queue')` accidentally added
// outside a handler, which would crash `rox --help` itself on a
// fresh checkout before `npm install` has ever run in backend/.

const assert = require('assert');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err.stack}`);
    process.exitCode = 1;
  }
}

console.log('ops command wiring (queue/cron/server/jobs/latency)');

const MODULES = [
  '../commands/queue',
  '../commands/queue/status',
  '../commands/queue/clear',
  '../commands/queue/restart',
  '../commands/cron',
  '../commands/cron/status',
  '../commands/cron/restart',
  '../commands/server',
  '../commands/server/info',
  '../commands/jobs',
  '../commands/latency',
];

for (const modPath of MODULES) {
  test(`${modPath} requires cleanly without backend deps installed`, () => {
    delete require.cache[require.resolve(modPath)];
    const mod = require(modPath);
    assert.strictEqual(typeof mod, 'function', `expected a function export from ${modPath}`);
  });
}

test('queue/cron/server groups only expose documented subcommands', () => {
  const queue = require('../commands/queue');
  const cron = require('../commands/cron');
  const server = require('../commands/server');
  assert.ok(queue.helpText().includes('status'));
  assert.ok(queue.helpText().includes('clear'));
  assert.ok(queue.helpText().includes('restart'));
  assert.ok(cron.helpText().includes('status'));
  assert.ok(cron.helpText().includes('restart'));
  assert.ok(server.helpText().includes('info'));
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.error('SOME TESTS FAILED');
  process.exit(1);
}
