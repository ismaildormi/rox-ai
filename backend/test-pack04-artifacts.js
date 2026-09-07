'use strict';

const assert = require('node:assert/strict');
const { normalizeImageUrl, buildImageArtifact } = require('./lib/imageArtifactContract');
const SOURCE = '11111111-1111-4111-8111-111111111111';

assert.equal(normalizeImageUrl('https://cdn.example/image.png#unsafe'), 'https://cdn.example/image.png');
assert.throws(() => normalizeImageUrl('http://cdn.example/image.png'), error => error.code === 'invalid_image_result_protocol');
assert.throws(() => normalizeImageUrl('javascript:alert(1)'), error => error.code === 'invalid_image_result_protocol');
assert.throws(() => normalizeImageUrl('not-a-url'), error => error.code === 'invalid_image_result_url');

const artifact = buildImageArtifact({
  url: 'https://cdn.example/image.webp', operation: 'generate', provider: 'fal',
  model: 'model-a', referenceAssetIds: [SOURCE], options: { ratio: '1:1' }
});
assert.equal(artifact.version, 'pack-04.image-artifact.v1');
assert.equal(artifact.provider, 'fal');
assert.deepEqual(artifact.lineage.referenceAssetIds, [SOURCE]);
assert.equal(artifact.options.ratio, '1:1');

console.log('PASS: Pack 04 HTTPS image artifact and lineage contract');
