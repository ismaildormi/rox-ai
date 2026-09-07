'use strict';

const assert = require('node:assert/strict');
const {
  definition,
  validateDefinition,
  isEnforcementEnabled,
  assertRouteAllowed,
  resolveRoute,
  inventory
} = require('./lib/intelligenceRegistry');

validateDefinition();
assert.equal(definition.version, 'pack-02.intelligence-core.v1');
assert.equal(definition.enforcement.enabledByDefault, false);
assert.equal(definition.orchestration.enabledByDefault, false);

assert.deepEqual(
  definition.routes.chat,
  ['groq:gpt-oss-20b', 'groq:gpt-oss-120b', 'openrouter:nemotron-free', 'openrouter:free']
);
assert.deepEqual(
  definition.routes.code,
  ['groq:gpt-oss-120b', 'groq:gpt-oss-20b', 'openrouter:nemotron-free', 'openrouter:free']
);

assert.equal(isEnforcementEnabled({}), false);
assert.equal(isEnforcementEnabled({ ZUVYR_INTELLIGENCE_CORE_ENFORCEMENT: 'true' }), true);

const confirmed = { ZUVYR_GROQ_FREE_TIER_CONFIRMED: 'true' };
assert.equal(assertRouteAllowed({
  provider: 'groq', model: 'openai/gpt-oss-20b', capability: 'chat'
}, { env: confirmed }).id, 'groq:gpt-oss-20b');

assert.throws(() => assertRouteAllowed({
  provider: 'groq', model: 'openai/gpt-oss-20b', capability: 'chat'
}, { env: {} }), error => error.code === 'intelligence_route_condition_not_met');

assert.throws(() => assertRouteAllowed({
  provider: 'openrouter', model: 'openrouter/free', capability: 'chat'
}, { env: confirmed }), error => error.code === 'intelligence_route_blocked');

assert.throws(() => assertRouteAllowed({
  provider: 'unknown', model: 'unknown', capability: 'chat'
}, { env: confirmed }), error => error.code === 'unknown_intelligence_route');

assert.deepEqual(resolveRoute('chat', { env: confirmed }).map(route => route.model), [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b'
]);
assert.equal(resolveRoute('chat', { env: confirmed, includeBlocked: true }).length, 4);
assert.throws(() => resolveRoute('future_capability'), error => error.code === 'unknown_intelligence_capability');

const snapshot = inventory();
assert.equal(snapshot.providers.length, 8);
assert.equal(snapshot.models.length, 5);

console.log('PASS: Pack 02 provider/model registry, route order and fail-closed pricing guards');
