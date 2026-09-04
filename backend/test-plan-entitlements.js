#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  PLAN_IDS,
  normalizePlanId,
  getPlan,
  isPaidPlan,
  planHasFeature,
  minimumPlanForFeature
} = require('./lib/planEntitlements');

assert.deepStrictEqual(
  PLAN_IDS,
  ['free', 'plus', 'pro', 'legend', 'max']
);

assert.strictEqual(normalizePlanId(' PLUS '), 'plus');
assert.strictEqual(normalizePlanId('unknown'), 'free');
assert.strictEqual(normalizePlanId(null), 'free');

assert.strictEqual(isPaidPlan('free'), false);
assert.strictEqual(isPaidPlan('plus'), true);
assert.strictEqual(isPaidPlan('max'), true);

assert.strictEqual(planHasFeature('free', 'chat'), true);
assert.strictEqual(planHasFeature('free', 'code'), false);
assert.strictEqual(planHasFeature('free', 'image'), false);
assert.strictEqual(planHasFeature('free', 'video'), false);
assert.strictEqual(planHasFeature('free', 'audio'), false);
assert.strictEqual(planHasFeature('free', 'ip'), false);

assert.strictEqual(planHasFeature('plus', 'code'), true);
assert.strictEqual(planHasFeature('plus', 'image'), true);
assert.strictEqual(planHasFeature('plus', 'audio'), true);
assert.strictEqual(planHasFeature('plus', 'video'), false);
assert.strictEqual(planHasFeature('plus', 'ip'), false);

assert.strictEqual(planHasFeature('pro', 'video'), true);
assert.strictEqual(planHasFeature('pro', 'ip'), false);
assert.strictEqual(planHasFeature('legend', 'ip'), true);
assert.strictEqual(planHasFeature('max', 'ip'), true);

assert.strictEqual(minimumPlanForFeature('code'), 'plus');
assert.strictEqual(minimumPlanForFeature('video'), 'pro');
assert.strictEqual(minimumPlanForFeature('ip'), 'legend');

assert.strictEqual(getPlan('plus').monthlyPriceUsd, 10);
assert.strictEqual(getPlan('pro').monthlyPriceUsd, 20);
assert.strictEqual(getPlan('legend').monthlyPriceUsd, 50);
assert.strictEqual(getPlan('max').monthlyPriceUsd, 100);

console.log(
  'PASS: ZUVYR V1 plan entitlements, prices and feature gates'
);
console.log(
  'DATABASE / STRIPE / MODEL CALLS: NONE'
);
