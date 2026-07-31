#!/usr/bin/env node
// ROX AI — cli/tests/test-setup-redis-check.js
//
// Regression test for a confirmed bug in cli/commands/setup.js's
// checkRedis(): the connectivity probe was run via
// run(..., { allowFailure: true }), and run() (cli/lib/util.js) only
// throws on a non-zero exit code when allowFailure is false — so the
// surrounding try/catch could never observe a failed ping. checkRedis()
// always logged "Redis is reachable" and the Docker auto-recovery path
// (docker run ... rox-redis) was unreachable dead code regardless of
// whether Redis actually responded.
//
// This test drives checkRedis() in isolation with a mocked lib/util so
// no real Redis/Docker/network access is required, and asserts:
//   1. a failed ping (non-zero status) actually reaches the recovery
//      path instead of being swallowed;
//   2. a successful ping (status 0) does NOT trigger recovery;
//   3. a failed ping with Docker unavailable warns instead of crashing.

const assert = require('assert');
const Module = require('module');

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

console.log('setup.js checkRedis() reachability logic (audit bug regression)');

/**
 * Requires cli/commands/setup.js with cli/lib/util.js swapped out for a
 * mock, so checkRedis()'s destructured `run`/`commandExists`/`log`
 * reference the mock instead of doing real process spawns.
 */
function loadCheckRedisWithMockedUtil({ redisStatus, dockerAvailable }) {
  const utilPath = require.resolve('../lib/util');
  const setupPath = require.resolve('../commands/setup');
  const realUtil = require(utilPath);

  const calls = [];
  const silentLog = {};
  for (const key of Object.keys(realUtil.log)) silentLog[key] = () => {};

  const mockUtil = Object.assign({}, realUtil, {
    log: silentLog,
    commandExists(cmd) {
      calls.push({ fn: 'commandExists', cmd });
      return cmd === 'docker' ? dockerAvailable : realUtil.commandExists(cmd);
    },
    run(cmd, args, opts) {
      calls.push({ fn: 'run', cmd, args, opts });
      if (cmd === 'node') return redisStatus; // the ioredis ping check
      if (cmd === 'docker') return 0; // `docker run ...` "succeeds"
      return 0;
    },
  });

  // Swap the cached module for lib/util so setup.js's top-level
  // `const { run, ... } = require('../lib/util')` destructures the mock.
  const previousUtilEntry = require.cache[utilPath];
  const mockEntry = new Module(utilPath);
  mockEntry.exports = mockUtil;
  mockEntry.loaded = true;
  require.cache[utilPath] = mockEntry;

  delete require.cache[setupPath];
  let setupExports;
  try {
    setupExports = require(setupPath);
  } finally {
    // Always restore the real util module for anything requiring it later,
    // and re-require setup.js against the real util so other tests/CLI
    // usage in this same process aren't left pointing at the mock.
    if (previousUtilEntry) {
      require.cache[utilPath] = previousUtilEntry;
    } else {
      delete require.cache[utilPath];
    }
    delete require.cache[setupPath];
  }

  return { checkRedis: setupExports.checkRedis, calls };
}

test('checkRedis exports for isolated testing', () => {
  const { checkRedis } = loadCheckRedisWithMockedUtil({ redisStatus: 0, dockerAvailable: true });
  assert.strictEqual(typeof checkRedis, 'function');
});

test('unreachable local Redis with Docker available triggers the recovery path', () => {
  const { checkRedis, calls } = loadCheckRedisWithMockedUtil({ redisStatus: 1, dockerAvailable: true });
  checkRedis();
  const dockerRunCall = calls.find((c) => c.fn === 'run' && c.cmd === 'docker' && c.args[0] === 'run');
  assert.ok(dockerRunCall, 'expected `docker run ... rox-redis` to be invoked when the ping fails and Docker is available');
});

test('reachable local Redis does NOT trigger the recovery path', () => {
  const { checkRedis, calls } = loadCheckRedisWithMockedUtil({ redisStatus: 0, dockerAvailable: true });
  checkRedis();
  const dockerRunCall = calls.find((c) => c.fn === 'run' && c.cmd === 'docker' && c.args[0] === 'run');
  assert.strictEqual(dockerRunCall, undefined, 'docker should not be started when the ping already succeeded');
});

test('unreachable local Redis with Docker unavailable does not throw (warns instead)', () => {
  const { checkRedis, calls } = loadCheckRedisWithMockedUtil({ redisStatus: 1, dockerAvailable: false });
  assert.doesNotThrow(() => checkRedis());
  const dockerRunCall = calls.find((c) => c.fn === 'run' && c.cmd === 'docker' && c.args[0] === 'run');
  assert.strictEqual(dockerRunCall, undefined, 'docker run should not be attempted when Docker is not installed');
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) {
  console.error('Some tests FAILED.');
} else {
  console.log('All setup checkRedis() tests passed.');
}
