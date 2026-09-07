'use strict';
const assert = require('node:assert/strict');
const { config, normalizeCapability, assertCodeCapabilityAvailable, publicInventory } = require('./lib/codeStudioRegistry');

assert.equal(config.version, 'pack-06.code-studio.v1');
assert.equal(normalizeCapability(' Preview '), 'preview');
assert.equal(assertCodeCapabilityAvailable('files').capability, 'files');
for (const capability of ['terminal', 'run', 'dependencies', 'build', 'test', 'deploy']) {
  assert.equal(config.capabilities[capability].enabledByDefault, false);
  assert.throws(() => assertCodeCapabilityAvailable(capability), error => error.capability === capability);
}
assert.equal(publicInventory().preview.networkEnabledByDefault, false);
assert.deepEqual(publicInventory().preview.sandboxTokens, ['allow-scripts']);
assert.throws(() => normalizeCapability('shell'), { code: 'unknown_code_capability' });
console.log('PASS: Pack 06 Code Studio capability registry fails closed');
