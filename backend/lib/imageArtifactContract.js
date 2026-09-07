'use strict';

function artifactError(code) { const error = new Error(code); error.code = code; return error; }

function normalizeImageUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch (_) { throw artifactError('invalid_image_result_url'); }
  if (url.protocol !== 'https:') throw artifactError('invalid_image_result_protocol');
  url.hash = '';
  return url.toString();
}

function buildImageArtifact({ url, operation = 'generate', provider = null, model = null, referenceAssetIds = [], sourceAssetId = null, maskAssetId = null, options = {} } = {}) {
  return Object.freeze({
    version: 'pack-04.image-artifact.v1',
    url: normalizeImageUrl(url),
    operation: String(operation),
    provider: provider ? String(provider) : null,
    model: model ? String(model) : null,
    lineage: Object.freeze({ referenceAssetIds: Object.freeze([...referenceAssetIds]), sourceAssetId, maskAssetId }),
    options: Object.freeze({ ...options })
  });
}

module.exports = { normalizeImageUrl, buildImageArtifact };
