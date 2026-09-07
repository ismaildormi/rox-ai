'use strict';
const assert = require('node:assert/strict');
const { validateRegistry } = require('./lib/costRegistry');
const { config, normalizeIpActionType, assertIpExecutionAvailable, publicInventory } = require('./lib/ipCapabilityRegistry');

validateRegistry();
assert.equal(config.version, 'pack-08.zuvyr-ip.v1');
assert.equal(config.execution.enabledByDefault, false);
assert.equal(config.execution.sandboxConfigured, false);
assert.equal(config.execution.networkEnabledByDefault, false);
assert.equal(config.execution.secretsAvailableToAgent, false);
assert.throws(() => assertIpExecutionAvailable(), { code: 'roxip_execution_disabled' });
for (const action of Object.keys(config.actions)) assert.equal(normalizeIpActionType(action.toUpperCase()), action);
for (const capability of ['device_connection','screen_capture','pointer_control','keyboard_control','application_control','filesystem_control','shell_control']) assert.equal(config.capabilities[capability].enabledByDefault, false);
assert.equal(publicInventory().execution.enabled, false);
const costs = require('./config/cost-registry.v1.json').entries.filter(entry => entry.id.startsWith('unassigned-computer-control-'));
assert.equal(costs.length, 2);
for (const entry of costs) { assert.equal(entry.enabledState, 'blocked'); assert.equal(entry.verificationStatus, 'unverified'); assert.equal(entry.targetGrossMarginBps, 5000); }
console.log('PASS: Pack 08 ZUVYR IP registry, sandbox defaults and computer-control costs fail closed');
