'use strict';

const assert = require('node:assert/strict');
const { normalizeProviderOutput, generateVideo } = require('./lib/videoProvider');

assert.equal(normalizeProviderOutput(['https://cdn.example/a.mp4']), 'https://cdn.example/a.mp4');
assert.equal(normalizeProviderOutput({ url: 'https://cdn.example/b.mp4' }), 'https://cdn.example/b.mp4');
assert.throws(() => normalizeProviderOutput({}), error => error.code === 'video_provider_returned_no_url');

async function run() {
  let captured = null;
  const result = await generateVideo(
    { operation: 'text_to_video', prompt: 'Ocean wave' },
    {
      env: { REPLICATE_API_TOKEN: 'test-token', REPLICATE_VIDEO_MODEL: 'owner/model' },
      createClient: token => ({
        async run(model, input) {
          captured = { token, model, input };
          return ['https://cdn.example/video.mp4'];
        }
      })
    }
  );
  assert.deepEqual(captured, {
    token: 'test-token', model: 'owner/model', input: { input: { prompt: 'Ocean wave' } }
  });
  assert.equal(result.provider, 'replicate');
  assert.equal(result.url, 'https://cdn.example/video.mp4');
  await assert.rejects(
    () => generateVideo({ operation: 'text_to_video', prompt: 'x' }, { env: {}, createClient: () => { throw new Error('network_must_not_start'); } }),
    error => error.code === 'replicate_video_provider_not_configured'
  );
  await assert.rejects(
    () => generateVideo({ operation: 'edit', prompt: '' }, { env: { REPLICATE_API_TOKEN: 'test' } }),
    error => error.code === 'video_operation_not_supported_by_provider'
  );
  console.log('PASS: Pack 05 injected Replicate adapter and no-token pre-network guard');
}

run().catch(error => { console.error(error); process.exit(1); });
