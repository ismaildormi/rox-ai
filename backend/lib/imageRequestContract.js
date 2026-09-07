'use strict';

const { config, normalizeImageOperation } = require('./imageOperationRegistry');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestError(code) { const error = new Error(code); error.code = code; return error; }

function normalizeImageRequest(body = {}) {
  const operation = normalizeImageOperation(body.imageOperation);
  const definition = config.operations[operation];
  const ids = body.referenceAssetIds === undefined ? [] : body.referenceAssetIds;
  if (!Array.isArray(ids) || ids.length > config.requestLimits.maxReferenceAssets || ids.some(id => typeof id !== 'string' || !UUID.test(id))) throw requestError('invalid_image_reference_assets');
  const referenceAssetIds = [...new Set(ids)];
  const sourceAssetId = body.sourceAssetId == null ? null : String(body.sourceAssetId);
  const maskAssetId = body.maskAssetId == null ? null : String(body.maskAssetId);
  if (sourceAssetId && !UUID.test(sourceAssetId)) throw requestError('invalid_image_source_asset');
  if (maskAssetId && !UUID.test(maskAssetId)) throw requestError('invalid_image_mask_asset');
  if (definition.requiresSource && !sourceAssetId && referenceAssetIds.length === 0) throw requestError('image_source_required');
  if (definition.requiresMask && !maskAssetId) throw requestError('image_mask_required');
  const raw = body.imageOptions && typeof body.imageOptions === 'object' && !Array.isArray(body.imageOptions) ? body.imageOptions : {};
  const allowed = new Set(['ratio', 'resolution', 'quantity', 'style', 'seed']);
  if (Object.keys(raw).some(key => !allowed.has(key))) throw requestError('unsupported_image_option');
  const ratio = raw.ratio || '1:1';
  const resolution = String(raw.resolution || '1024');
  const quantity = raw.quantity === undefined ? 1 : Number(raw.quantity);
  if (!config.requestLimits.allowedRatios.includes(ratio)) throw requestError('invalid_image_ratio');
  if (!config.requestLimits.allowedResolutions.includes(resolution)) throw requestError('invalid_image_resolution');
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > config.requestLimits.maxQuantity) throw requestError('invalid_image_quantity');
  const style = String(raw.style || '').trim().slice(0, 80) || null;
  const seed = raw.seed == null ? null : Number(raw.seed);
  if (seed !== null && (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647)) throw requestError('invalid_image_seed');
  return Object.freeze({ operation, referenceAssetIds: Object.freeze(referenceAssetIds), sourceAssetId, maskAssetId, options: Object.freeze({ ratio, resolution, quantity, style, seed }) });
}

module.exports = { normalizeImageRequest };
