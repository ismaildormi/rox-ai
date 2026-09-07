'use strict';

const { normalizeVideoOperation } = require('./videoOperationRegistry');

function artifactError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeVideoUrl(value, required = true) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  let url;
  try {
    url = new URL(String(value || ''));
  } catch (_) {
    throw artifactError('invalid_video_result_url');
  }
  if (url.protocol !== 'https:') throw artifactError('invalid_video_result_protocol');
  url.hash = '';
  return url.toString();
}

function buildVideoArtifact({
  url,
  previewUrl = null,
  exportUrl = null,
  operation = 'text_to_video',
  provider = null,
  model = null,
  sourceImageAssetId = null,
  sourceVideoAssetId = null,
  startFrameAssetId = null,
  endFrameAssetId = null,
  options = {}
} = {}) {
  const normalizedUrl = normalizeVideoUrl(url);
  return Object.freeze({
    version: 'pack-05.video-artifact.v1',
    type: 'video',
    url: normalizedUrl,
    previewUrl: normalizeVideoUrl(previewUrl, false) || normalizedUrl,
    exportUrl: normalizeVideoUrl(exportUrl, false),
    operation: normalizeVideoOperation(operation),
    provider: provider ? String(provider) : null,
    model: model ? String(model) : null,
    lineage: Object.freeze({
      sourceImageAssetId,
      sourceVideoAssetId,
      startFrameAssetId,
      endFrameAssetId
    }),
    options: Object.freeze({ ...options })
  });
}

module.exports = { normalizeVideoUrl, buildVideoArtifact };
