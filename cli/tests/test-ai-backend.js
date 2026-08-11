#!/usr/bin/env node
// ROX AI — cli/tests/test-ai-backend.js
//
// Exercises cli/lib/aiBackend.js and the parts of `rox ai *` that don't
// need bullmq/ioredis/@supabase/supabase-js installed (providers
// registry + src/core/config are dependency-free) — runs anywhere.
// aiRouter.js/lib/modelHealth.js paths (which DO need those deps) are
// covered by the graceful-degradation checks here, and manually against
// stub packages during development (see PR notes) — not re-stubbed in
// this repo's test suite on purpose, so `node cli/tests/*.js` never
// silently depends on fake packages matching real ones.

const assert = require('assert');
const { loadProviders, loadConfig, loadAiRouter, PROVIDER_ENV_VAR } = require('../lib/aiBackend');

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

console.log('aiBackend (dependency-free modules)');

test('loadProviders() succeeds without backend node_modules installed', () => {
  const result = loadProviders();
  assert.strictEqual(result.ok, true, result.error && result.error.message);
});

test('every built-in provider is registered', () => {
  const { module } = loadProviders();
  const keys = module.listProviders().map((p) => p.key);
  for (const expected of ['anthropic', 'openrouter', 'openai', 'google', 'groq', 'local']) {
    assert.ok(keys.includes(expected), `expected ${expected} in ${keys}`);
  }
});

test('every provider requiring a credential is in PROVIDER_ENV_VAR', () => {
  const { module } = loadProviders();
  for (const { key } of module.listProviders()) {
    if (key === 'local') continue; // no key required by default
    assert.ok(PROVIDER_ENV_VAR[key], `missing PROVIDER_ENV_VAR entry for "${key}" — cli/commands/ai/providers.js would silently skip it`);
  }
});

test('loadConfig() exposes models.rates and models.defaultRate', () => {
  const result = loadConfig();
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  assert.ok(result.module.models.rates, 'models.rates missing');
  assert.ok(result.module.models.defaultRate, 'models.defaultRate missing');
});

test('every ROUTES model has a config/models.json rates entry (would otherwise silently use defaultRate)', () => {
  const routerResult = loadAiRouter();
  if (!routerResult.ok) {
    console.log(`    skipped — aiRouter.js needs backend deps installed (${routerResult.error.message})`);
    return;
  }
  const { rates } = loadConfig().module.models;
  const routedModels = new Set(Object.values(routerResult.module.ROUTES).flat().map((r) => r.model));
  const unpriced = [...routedModels].filter((m) => !(m in rates));
  assert.deepStrictEqual(unpriced, [], `routed models missing a rates entry: ${unpriced.join(', ')}`);
});

test('every ROUTES provider is registered in the providers registry', () => {
  const routerResult = loadAiRouter();
  if (!routerResult.ok) {
    console.log(`    skipped — aiRouter.js needs backend deps installed (${routerResult.error.message})`);
    return;
  }
  const { module: providersModule } = loadProviders();
  const registered = new Set(providersModule.listProviders().map((p) => p.key));
  const routedProviders = new Set(Object.values(routerResult.module.ROUTES).flat().map((r) => r.provider));
  for (const provider of routedProviders) {
    assert.ok(registered.has(provider), `ROUTES references unregistered provider "${provider}"`);
  }
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.error('SOME TESTS FAILED');
  process.exit(1);
}

// ROX_TEST_FORCE_EXIT - test runner completed; do not keep deployment validation alive.
process.exit(process.exitCode || 0);

