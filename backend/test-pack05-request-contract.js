'use strict';

const assert = require('node:assert/strict');
const { normalizeVideoRequest } = require('./lib/videoRequestContract');
const IMAGE = '11111111-1111-4111-8111-111111111111';
const VIDEO = '22222222-2222-4222-8222-222222222222';
const END = '33333333-3333-4333-8333-333333333333';

const text = normalizeVideoRequest({ prompt: '  Moroccan coast at sunrise  ' });
assert.equal(text.operation, 'text_to_video');
assert.equal(text.prompt, 'Moroccan coast at sunrise');
assert.deepEqual(text.options, {
  durationSeconds: 5, ratio: '16:9', resolution: '720p', fps: 24,
  audio: false, seed: null, subtitleLanguage: 'auto',
  targetLanguage: 'auto', exportFormat: 'mp4'
});

const image = normalizeVideoRequest({
  videoOperation: 'image_to_video', prompt: 'Move slowly', startFrameAssetId: IMAGE,
  endFrameAssetId: END, videoOptions: { durationSeconds: 8, ratio: '9:16' }
});
assert.equal(image.startFrameAssetId, IMAGE);
assert.equal(image.endFrameAssetId, END);
assert.equal(image.options.durationSeconds, 8);

const edit = normalizeVideoRequest({ videoOperation: 'edit', sourceVideoAssetId: VIDEO });
assert.equal(edit.prompt, '');
assert.equal(edit.sourceVideoAssetId, VIDEO);

for (const [body, code] of [
  [{}, 'video_prompt_required'],
  [{ videoOperation: 'image_to_video', prompt: 'Move' }, 'video_source_image_required'],
  [{ videoOperation: 'edit' }, 'video_source_video_required'],
  [{ prompt: 'x', endFrameAssetId: END }, 'video_start_frame_required'],
  [{ prompt: 'x', sourceImageAssetId: 'bad' }, 'invalid_video_source_image'],
  [{ prompt: 'x', videoOptions: [] }, 'invalid_video_options'],
  [{ prompt: 'x', videoOptions: { durationSeconds: 99 } }, 'invalid_video_duration'],
  [{ prompt: 'x', videoOptions: { ratio: '2:1' } }, 'invalid_video_ratio'],
  [{ prompt: 'x', videoOptions: { resolution: '4k' } }, 'invalid_video_resolution'],
  [{ prompt: 'x', videoOptions: { fps: 60 } }, 'invalid_video_fps'],
  [{ prompt: 'x', videoOptions: { audio: 'yes' } }, 'invalid_video_audio'],
  [{ prompt: 'x', videoOptions: { exportFormat: 'exe' } }, 'invalid_video_export_format'],
  [{ prompt: 'x', videoOptions: { secret: true } }, 'unsupported_video_option']
]) assert.throws(() => normalizeVideoRequest(body), error => error.code === code, code);

console.log('PASS: Pack 05 text/image/edit/source-frame and bounded option contracts');
