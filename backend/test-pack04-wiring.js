'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const server = read('server.js');
const generationServer = server.slice(server.indexOf('async function handleGenerationRequest'));
const worker = read('worker.js');
const memory = read('lib/conversationGeneration.js');
const flags = JSON.parse(read('config/feature-flags.json'));

for (const marker of [
  'validateImageBody', 'assertImageRequestAvailable(imageRequest)',
  'image_operation: imageRequest.operation', 'reference_asset_ids: imageRequest.referenceAssetIds',
  'imageOperation: imageRequest?.operation', "app.post('/api/generate-image'"
]) assert(server.includes(marker), `Missing server marker: ${marker}`);
assert(generationServer.indexOf('assertImageRequestAvailable(imageRequest)') < generationServer.indexOf('pricing = quoteGeneration(feature)'));
assert(generationServer.indexOf('assertImageRequestAvailable(imageRequest)') < generationServer.indexOf('reservation = await reserveCredits'));

for (const marker of [
  "require('./lib/imageArtifactContract')", 'buildImageArtifact({',
  'operation: imageOperation', 'result_url: artifact.url'
]) assert(worker.includes(marker), `Missing worker marker: ${marker}`);
for (const marker of ['operation,', 'referenceAssetIds,', 'sourceAssetId,', 'maskAssetId,', 'reference_asset_ids: referenceAssetIds']) {
  assert(memory.includes(marker), `Missing history marker: ${marker}`);
}

assert.equal(flags.image_generation.enabled, true);
assert.equal(flags.image_history.enabled, true);
for (const key of [
  'image_reference', 'image_editing', 'image_variations', 'image_remove_background',
  'image_upscale', 'image_inpainting', 'image_expand'
]) assert.equal(flags[key].enabled, false, `${key} must stay disabled`);

console.log('PASS: Pack 04 pre-charge guard, queue, worker artifact and history wiring');
