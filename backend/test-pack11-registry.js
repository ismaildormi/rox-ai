'use strict';
const assert = require('node:assert/strict');
const config = require('./config/unified-product.v1.json');
const ids = config.sections.map(section => section.id);
for (const id of ['dashboard','images','video','code','voice','music','ip','research','library','projects','documents','spreadsheets','presentations','scheduled','plugins','usage','analytics','settings']) assert(ids.includes(id), `Missing ${id}`);
assert.equal(new Set(ids).size, ids.length); assert.equal(config.orchestration.planningEnabled,true); assert.equal(config.orchestration.executionEnabled,false); assert.equal(config.orchestration.unknownPricePolicy,'block_before_provider_call');
assert.equal(config.zuvyrIp.deviceControlEnabled,false); assert.equal(config.zuvyrIp.wildcardScopesAllowed,false);
for (const edge of [['research','code'],['images','code'],['video','code'],['audio','video'],['library','projects']]) assert(config.connections.some(item => item.from===edge[0] && item.to===edge[1]), `Missing edge ${edge.join('->')}`);
console.log('PASS: Pack 11 unified product registry covers interfaces and cross-feature handoffs');
