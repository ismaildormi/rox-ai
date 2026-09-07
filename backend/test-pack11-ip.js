'use strict';
const assert = require('node:assert/strict');
const { ALLOWED_SCOPES, buildIpToolPlan } = require('./lib/zuvyrIpToolAccess');
assert(ALLOWED_SCOPES.has('images.propose')); assert(ALLOWED_SCOPES.has('code.propose'));
assert.throws(() => buildIpToolPlan({ goal:'Build project', scopes:['*'], explicitConsent:true }), /ip_scope_not_allowed/);
assert.throws(() => buildIpToolPlan({ goal:'Build project', scopes:['code.propose'] }), /ip_explicit_consent_required/);
const plan = buildIpToolPlan({ goal:'Coordinate a product launch plan', scopes:['research.propose','images.propose','code.propose'], explicitConsent:true });
assert.equal(plan.executionEnabled,false); assert.equal(plan.deviceControlEnabled,false); assert.equal(plan.shellEnabled,false); assert.equal(plan.auditRequired,true); assert.equal(plan.stopAvailable,true);
console.log('PASS: Pack 11 ZUVYR IP uses exact consented planning scopes with execution disabled');
