'use strict';

const assert = require('node:assert/strict');
const { normalizeVideoUrl, buildVideoArtifact } = require('./lib/videoArtifactContract');
const {
  normalizeProgress,
  assertVideoJobTransition,
  buildVideoJobSnapshot
} = require('./lib/videoJobContract');
const SOURCE = '11111111-1111-4111-8111-111111111111';

assert.equal(normalizeVideoUrl('https://cdn.example/video.mp4#part'), 'https://cdn.example/video.mp4');
assert.throws(() => normalizeVideoUrl('http://cdn.example/video.mp4'), error => error.code === 'invalid_video_result_protocol');
const artifact = buildVideoArtifact({
  url: 'https://cdn.example/video.mp4',
  operation: 'image_to_video',
  provider: 'replicate',
  model: 'video-model',
  sourceImageAssetId: SOURCE,
  options: { durationSeconds: 5 }
});
assert.equal(artifact.version, 'pack-05.video-artifact.v1');
assert.equal(artifact.previewUrl, artifact.url);
assert.equal(artifact.lineage.sourceImageAssetId, SOURCE);

assert.equal(normalizeProgress(90), 90);
assert.throws(() => normalizeProgress(101), error => error.code === 'invalid_video_job_progress');
assert.equal(assertVideoJobTransition('queued', 'processing'), true);
assert.equal(assertVideoJobTransition('processing', 'done'), true);
assert.throws(() => assertVideoJobTransition('done', 'processing'), error => error.code === 'invalid_video_job_transition');

const snapshot = buildVideoJobSnapshot({
  status: 'done', feature: 'video', result_url: artifact.url,
  preview_url: artifact.previewUrl, video_operation: 'image_to_video',
  progress_percent: 100, job_stage: 'done', estimated_seconds: 0,
  cancel_requested: false, user_id: 'must-not-leak'
});
assert.equal(snapshot.result_url, artifact.url);
assert.equal(snapshot.progress_percent, 100);
assert.equal(Object.hasOwn(snapshot, 'user_id'), false);

console.log('PASS: Pack 05 HTTPS artifacts, job transitions, progress and public snapshot');
