'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const router = fs.readFileSync(path.join(__dirname, 'aiRouter.js'), 'utf8');
const flags = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/feature-flags.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/intelligence-core.v1.json'), 'utf8'));

assert(router.includes("require('./lib/intelligenceRegistry')"));
assert(router.includes('intelligenceRegistry.isEnforcementEnabled()'));
assert(router.includes('intelligenceRegistry.assertRouteAllowed'));
assert.equal(flags.intelligence_core.enabled, false);
assert.equal(flags.task_orchestration.enabled, false);
assert.equal(registry.enforcement.enabledByDefault, false);
assert.equal(registry.orchestration.enabledByDefault, false);

console.log('PASS: Pack 02 router guard wiring and disabled-by-default feature gates');
