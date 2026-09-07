'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const server = read('server.js');
const generation = server.slice(server.indexOf('async function handleGenerationRequest'));
const worker = read('worker.js');
const flags = JSON.parse(read('config/feature-flags.json'));

for (const marker of [
  'validateVideoBody', 'assertVideoRequestAvailable(videoRequest)',
  'video_operation: videoRequest.operation', 'progress_percent: 0',
  'videoOperation: videoRequest?.operation', 'buildVideoJobSnapshot(data)',
  "assertVideoRequestAvailable({ operation: 'text_to_video' })",
  "app.post('/api/generate-video'"
]) assert(server.includes(marker), `Missing server marker: ${marker}`);
assert(generation.indexOf('assertVideoRequestAvailable(videoRequest)') < generation.indexOf('pricing = quoteGeneration(feature)'));
assert(generation.indexOf('assertVideoRequestAvailable(videoRequest)') < generation.indexOf('reservation = await reserveCredits'));

for (const marker of [
  "require('./lib/videoProvider')", 'assertVideoRequestAvailable(videoRequest)',
  'const result = await generateVideo', 'buildVideoArtifact({',
  "job_stage: 'preview'", "job_stage: 'done'", 'preview_url: artifact.previewUrl'
]) assert(worker.includes(marker), `Missing worker marker: ${marker}`);
assert(worker.indexOf('assertVideoRequestAvailable(videoRequest)') < worker.indexOf('const result = await generateVideo'));

assert.equal(flags.video_generation.enabled, false);
assert.equal(flags.video_jobs.enabled, true);
assert.equal(flags.video_preview.enabled, true);
assert.equal(flags.video_history.enabled, true);
for (const key of [
  'video_image_to_video', 'video_editing', 'video_extend', 'video_subtitles',
  'video_enhance', 'video_export', 'video_cancel'
]) assert.equal(flags[key].enabled, false, `${key} must stay disabled`);

console.log('PASS: Pack 05 pre-charge/worker guards, jobs, progress, preview and flags wiring');
