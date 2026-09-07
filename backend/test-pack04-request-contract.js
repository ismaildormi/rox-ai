'use strict';

const assert = require('node:assert/strict');
const { normalizeImageRequest } = require('./lib/imageRequestContract');
const SOURCE = '11111111-1111-4111-8111-111111111111';
const MASK = '22222222-2222-4222-8222-222222222222';

const defaults = normalizeImageRequest({});
assert.equal(defaults.operation, 'generate');
assert.deepEqual(defaults.referenceAssetIds, []);
assert.deepEqual(defaults.options, { ratio: '1:1', resolution: '1024', quantity: 1, style: null, seed: null });

const edit = normalizeImageRequest({ imageOperation: 'edit', sourceAssetId: SOURCE });
assert.equal(edit.sourceAssetId, SOURCE);
const inpaint = normalizeImageRequest({ imageOperation: 'inpaint', sourceAssetId: SOURCE, maskAssetId: MASK });
assert.equal(inpaint.maskAssetId, MASK);
const references = normalizeImageRequest({ imageOperation: 'reference_generate', referenceAssetIds: [SOURCE, SOURCE] });
assert.deepEqual(references.referenceAssetIds, [SOURCE]);

for (const [body, code] of [
  [{ imageOperation: 'edit' }, 'image_source_required'],
  [{ imageOperation: 'inpaint', sourceAssetId: SOURCE }, 'image_mask_required'],
  [{ referenceAssetIds: ['bad-id'] }, 'invalid_image_reference_assets'],
  [{ imageOptions: { ratio: '2:1' } }, 'invalid_image_ratio'],
  [{ imageOptions: { resolution: '999' } }, 'invalid_image_resolution'],
  [{ imageOptions: { quantity: 5 } }, 'invalid_image_quantity'],
  [{ imageOptions: { seed: -1 } }, 'invalid_image_seed'],
  [{ imageOptions: { secret: true } }, 'unsupported_image_option']
]) {
  assert.throws(() => normalizeImageRequest(body), error => error.code === code, code);
}

console.log('PASS: Pack 04 normalized image request, lineage and option validation');
