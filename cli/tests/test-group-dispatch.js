#!/usr/bin/env node
// ROX AI — cli/tests/test-group-dispatch.js
//
// Standalone smoke test for cli/lib/group.js — the dispatcher every
// multi-word command (`rox ai <sub>`, `rox update <sub>`) is built on.
// No external dependencies; safe to run anywhere Node runs.
//
// Usage: node cli/tests/test-group-dispatch.js

const assert = require('assert');
const { makeGroup } = require('../lib/group');

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ok - ${name}`);
      passed++;
    })
    .catch((err) => {
      console.error(`  FAIL - ${name}`);
      console.error(`    ${err.message}`);
      process.exitCode = 1;
    });
}

async function main() {
  console.log('group dispatch');

  await test('runs the matching subcommand and passes through remaining args', async () => {
    let received = null;
    const group = makeGroup({
      name: 'x',
      subcommands: { foo: { handler: (args) => { received = args; }, summary: 'foo' } },
    });
    await group(['foo', 'a', 'b']);
    assert.deepStrictEqual(received, ['a', 'b']);
  });

  await test('falls back to defaultSubcommand when no subcommand is given', async () => {
    let ran = false;
    const group = makeGroup({
      name: 'x',
      defaultSubcommand: 'status',
      subcommands: { status: { handler: () => { ran = true; }, summary: 's' } },
    });
    await group([]);
    assert.strictEqual(ran, true);
  });

  await test('treats a leading flag as belonging to the default subcommand, not a subcommand name', async () => {
    let received = null;
    const group = makeGroup({
      name: 'x',
      defaultSubcommand: 'status',
      subcommands: { status: { handler: (args) => { received = args; }, summary: 's' } },
    });
    await group(['--fix']);
    assert.deepStrictEqual(received, ['--fix']);
  });

  await test('unknown subcommand exits non-zero and does not throw', async () => {
    const group = makeGroup({ name: 'x', subcommands: { foo: { handler: () => {}, summary: 'foo' } } });
    process.exitCode = 0;
    await group(['bar']);
    assert.strictEqual(process.exitCode, 1);
    process.exitCode = 0;
  });

  await test('no subcommand and no default exits non-zero and does not throw', async () => {
    const group = makeGroup({ name: 'x', subcommands: { foo: { handler: () => {}, summary: 'foo' } } });
    process.exitCode = 0;
    await group([]);
    assert.strictEqual(process.exitCode, 1);
    process.exitCode = 0;
  });

  await test('-h/--help/help all print help without running a handler', async () => {
    let ran = false;
    const group = makeGroup({
      name: 'x',
      defaultSubcommand: 'status',
      subcommands: { status: { handler: () => { ran = true; }, summary: 's' } },
    });
    for (const helpArg of ['-h', '--help', 'help']) {
      ran = false;
      await group([helpArg]);
      assert.strictEqual(ran, false, `handler should not run for ${helpArg}`);
    }
  });

  console.log(`\n${passed} passed`);
  if (process.exitCode) {
    console.error('SOME TESTS FAILED');
    process.exit(1);
  }
}

main();
