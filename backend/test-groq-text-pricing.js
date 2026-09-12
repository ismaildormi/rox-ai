'use strict';

const assert = require('node:assert/strict');
const { estimateGroqTextProviderUpperBound: estimate } = require('./lib/groqTextPricing');
const catalog = require('./config/groq-text-pricing.verified.v1.json');
const now = Date.parse('2026-09-12T00:00:00Z');
const base = { model: 'openai/gpt-oss-20b', inputTokens: 2000, outputTokens: 1000 };
let groups = 0;
function test(name, fn) { fn(); groups++; console.log('PASS: ' + name); }
function quote(overrides = {}, options = {}) { return estimate({ ...base, ...overrides }, { now, ...options }); }

test('published Groq rates are served through the authoritative cost registry', () => {
  assert.equal(quote().providerCostUpperBoundMicroUsd, '450');
  assert.equal(quote({ model: 'openai/gpt-oss-120b' }).providerCostUpperBoundMicroUsd, '900');
  assert.match(quote().pricingVersion, /^pack-014\./);
});

test('exact integer arithmetic and conservative micro-dollar rounding', () => {
  assert.equal(quote({ inputTokens: 1, outputTokens: 1 }).providerCostUpperBoundMicroUsd, '1');
  assert.equal(quote({ inputTokens: '2000', outputTokens: '1000' }).providerCostUpperBoundMicroUsd, '450');
  assert.equal(quote({ inputTokens: 0, outputTokens: 0 }).providerCostUpperBoundMicroUsd, '0');
});

test('unknown models, alternate service tiers and tool charges fail closed', () => {
  assert.throws(() => quote({ model: 'openrouter/free' }), /unknown_priced_model/);
  assert.throws(() => quote({ model: '__proto__' }), /unknown_priced_model/);
  assert.throws(() => quote({ serviceTier: 'performance' }), /unsupported_pricing_scope/);
  assert.throws(() => quote({ toolsUsed: true }), /unsupported_pricing_scope/);
});

test('malformed token measurements and model limits are rejected', () => {
  for (const inputTokens of [null, undefined, true, false, -1, 0.5, NaN, Infinity, '', '1e3', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => quote({ inputTokens }), /invalid_input_tokens/);
  }
  assert.throws(() => quote({ outputTokens: 65537 }), /model_token_limit_exceeded/);
  assert.throws(() => quote({ inputTokens: 131072, outputTokens: 1 }), /model_token_limit_exceeded/);
});

test('expired registry pricing cannot silently become zero', () => {
  assert.throws(
    () => quote({}, { now: Date.parse('2026-09-15T00:00:00Z') }),
    /cost_entry_expired/
  );
  assert.equal(catalog.models[base.model].inputPriceMicroUsd, undefined);
  assert.equal(catalog.models[base.model].outputPriceMicroUsd, undefined);
});

test('provider estimate does not claim an invoice or customer credit quote', () => {
  assert.equal(quote().customerCreditQuoteReady, false);
  assert.equal(quote().accountActualCostVerified, false);
  assert(Object.isFrozen(quote()));
});

console.log('GROQ TEXT PRICING TEST GROUPS: ' + groups + '. No model/payment/database calls.');
