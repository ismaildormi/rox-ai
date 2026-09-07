'use strict';
const assert=require('node:assert/strict'); const config=require('./config/unified-product.v1.json'); const flags=require('./config/feature-flags.json');
assert.equal(config.orchestration.executionEnabled,false); assert.equal(config.zuvyrIp.toolExecutionEnabled,false); assert.equal(config.zuvyrIp.deviceControlEnabled,false);
for(const key of ['cross_feature_execution','zuvyr_ip_tool_execution','customer_billing_activation','public_launch','store_submission']) assert.equal(flags[key].enabled,false,`${key} must be disabled`);
console.log('PASS: Pack 11 does not activate providers, credits, billing, deploy, stores or device control');
