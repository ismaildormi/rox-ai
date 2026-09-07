'use strict';

const Replicate = require('replicate');
const { providerSupports } = require('./videoOperationRegistry');

const DEFAULT_VIDEO_MODEL = 'wan-video/wan-2.2-t2v-fast';

function providerError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeProviderOutput(output) {
  const first = Array.isArray(output) ? output[0] : output;
  if (typeof first === 'string') return first;
  if (first && typeof first.url === 'function') return first.url();
  if (first && typeof first.url === 'string') return first.url;
  throw providerError('video_provider_returned_no_url');
}

async function generateVideo(request, {
  env = process.env,
  createClient = token => new Replicate({ auth: token })
} = {}) {
  if (!providerSupports('replicate', request.operation)) {
    throw providerError('video_operation_not_supported_by_provider');
  }
  if (!env.REPLICATE_API_TOKEN) {
    throw providerError('replicate_video_provider_not_configured');
  }
  const model = env.REPLICATE_VIDEO_MODEL || DEFAULT_VIDEO_MODEL;
  const client = createClient(env.REPLICATE_API_TOKEN);
  const output = await client.run(model, { input: { prompt: request.prompt } });
  return Object.freeze({
    url: normalizeProviderOutput(output),
    provider: 'replicate',
    model
  });
}

module.exports = { DEFAULT_VIDEO_MODEL, normalizeProviderOutput, generateVideo };
