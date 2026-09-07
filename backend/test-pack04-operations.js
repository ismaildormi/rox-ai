'use strict';

const assert = require('node:assert/strict');
const {
  config,
  assertImageOperationAvailable,
  assertImageRequestAvailable,
  providerSupports,
  inventory
} = require('./lib/imageOperationRegistry');

assert.equal(config.version, 'pack-04.image-system.v1');
assert.equal(assertImageOperationAvailable('generate').operation, 'generate');

for (const operation of [
  'reference_generate', 'edit', 'variations', 'remove_background',
  'upscale', 'inpaint', 'expand'
]) {
  assert.throws(
    () => assertImageOperationAvailable(operation),
    error => error.code === 'image_operation_unpriced' && error.operation === operation
  );
}

assert.throws(
  () => assertImageOperationAvailable('not-real'),
  error => error.code === 'unknown_image_operation'
);
assert.equal(providerSupports('fal', 'generate'), true);
assert.equal(providerSupports('replicate', 'generate'), true);
assert.equal(providerSupports('fal', 'edit'), false);
assert.equal(providerSupports('unknown', 'generate'), false);
assert.deepEqual(Object.keys(inventory().operations), Object.keys(config.operations));

assert.equal(assertImageRequestAvailable({
  operation: 'generate',
  referenceAssetIds: [],
  sourceAssetId: null,
  maskAssetId: null,
  options: { ratio: '1:1', resolution: '1024', quantity: 1, style: null, seed: null }
}).operation, 'generate');

for (const request of [
  { referenceAssetIds: ['11111111-1111-4111-8111-111111111111'] },
  { sourceAssetId: '11111111-1111-4111-8111-111111111111' },
  { options: { ratio: '16:9', resolution: '1024', quantity: 1, style: null, seed: null } },
  { options: { ratio: '1:1', resolution: '1024', quantity: 2, style: null, seed: null } }
]) {
  assert.throws(
    () => assertImageRequestAvailable({
      operation: 'generate', referenceAssetIds: [], sourceAssetId: null,
      maskAssetId: null,
      options: { ratio: '1:1', resolution: '1024', quantity: 1, style: null, seed: null },
      ...request
    }),
    error => error.code === 'image_generation_configuration_unavailable'
  );
}

console.log('PASS: Pack 04 image registry, provider capabilities and fail-closed activation');
