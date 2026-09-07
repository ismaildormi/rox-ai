'use strict';
const assert = require('node:assert/strict');
const { config, validateFinalProductConfig, publicReadinessInventory } = require('./lib/finalProductRegistry');
validateFinalProductConfig();
assert.deepEqual(config.interfaceOrder, ['dashboard','chat','images','video','code','voice_audio','zuvyr_ip','library_projects','usage_billing','settings']);
assert.equal(Object.keys(config.interfaces).length, 10);
for (const id of config.interfaceOrder) {
  assert(config.interfaces[id]);
  assert.equal(config.interfaces[id].productionVerified, false);
}
assert.deepEqual(config.requiredUxStates, ['empty','loading','progress','success','error','offline','limit_exhausted','payment_failed']);
assert(Object.values(config.activation).every(value => value === false));
const publicValue = publicReadinessInventory();
assert.equal(publicValue.mode, 'launch_readiness_foundation');
assert.equal(publicValue.interfaces.zuvyr_ip.status, 'demo_only');
console.log('PASS: Pack 10 exact interface order, UX states and honest production readiness registry');
