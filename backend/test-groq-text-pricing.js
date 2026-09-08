'use strict';
const assert = require('node:assert/strict');
const { estimateGroqTextProviderUpperBound: estimate } = require('./lib/groqTextPricing');
const catalog = require('./config/groq-text-pricing.verified.v1.json');
const now = Date.parse('2026-09-08T12:00:00Z');
const base = { model: 'openai/gpt-oss-20b', inputTokens: 2000, outputTokens: 1000 };
let groups = 0;
function test(name, fn) { fn(); groups++; console.log('PASS: ' + name); }
function quote(overrides = {}, options = {}) { return estimate({ ...base, ...overrides }, { now, ...options }); }

test('published 20B and 120B token rates, without a free-tier assumption', () => {
  assert.equal(quote().providerCostUpperBoundMicroUsd, '450');
  assert.equal(quote({ model: 'openai/gpt-oss-120b' }).providerCostUpperBoundMicroUsd, '900');
});
test('exact integer arithmetic, conservative micro-dollar rounding and zero usage', () => {
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
test('malformed token measurements and provider model limits are rejected', () => {
  for (const inputTokens of [null, undefined, true, false, -1, 0.5, NaN, Infinity, '', '1e3', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => quote({ inputTokens }), /invalid_input_tokens/);
  }
  assert.throws(() => quote({ outputTokens: 65537 }), /model_token_limit_exceeded/);
  assert.throws(() => quote({ inputTokens: 131072, outputTokens: 1 }), /model_token_limit_exceeded/);
});
test('expired, future or zero-priced catalog cannot silently allow requests', () => {
  assert.throws(() => quote({}, { catalog: { ...catalog, version: null } }), /invalid_pricing_catalog/);
  assert.throws(() => quote({}, { now: Date.parse(catalog.reviewBefore) }), /pricing_review_required/);
  assert.throws(() => quote({}, { now: Date.parse(catalog.verifiedAt) - 1 }), /pricing_review_required/);
  const changed = JSON.parse(JSON.stringify(catalog));
  changed.models[base.model].inputPriceMicroUsd = '0';
  assert.throws(() => quote({}, { catalog: changed }), /unverified_zero_price/);
});
test('provider estimate does not claim a customer credit quote or actual invoice', () => {
  assert.equal(quote().customerCreditQuoteReady, false);
  assert.equal(quote().accountActualCostVerified, false);
  assert(Object.isFrozen(quote()));
});
console.log('GROQ TEXT PRICING TEST GROUPS: ' + groups + '. No model/payment/database calls.');
