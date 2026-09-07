'use strict';

const assert = require('node:assert/strict');
const {
  prepareGenerationConversation,
  completeGenerationConversation
} = require('./lib/conversationGeneration');
const CONVERSATION = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';

async function run() {
  const calls = [];
  const store = {
    async requireOwnedConversation() {
      return { id: CONVERSATION, feature: 'videos', message_count: 0 };
    },
    async appendMessage(input) {
      calls.push(['message', input]);
      return { id: input.role === 'user' ? 1 : 2, ...input };
    },
    async addAsset(input) { calls.push(['asset', input]); return { id: SOURCE, ...input }; },
    async compactConversationMemory() { return { compacted: false }; }
  };
  const request = await prepareGenerationConversation({
    store, conversationId: CONVERSATION, ownerId: 'owner', feature: 'video',
    prompt: 'Extend it', operation: 'extend', sourceVideoAssetId: SOURCE,
    videoOptions: { durationSeconds: 5 }, requestKey: 'turn'
  });
  assert.equal(request.content.operation, 'extend');
  assert.equal(request.content.sourceVideoAssetId, SOURCE);
  const result = await completeGenerationConversation({
    store, conversationId: CONVERSATION, ownerId: 'owner', feature: 'video',
    resultUrl: 'https://cdn.example/video.mp4', operation: 'extend',
    sourceVideoAssetId: SOURCE, videoOptions: { durationSeconds: 5 }, requestKey: 'turn'
  });
  assert.equal(result.assistantMessage.content.lineage.sourceVideoAssetId, SOURCE);
  assert.equal(result.asset.metadata.source_video_asset_id, SOURCE);
  assert.deepEqual(result.asset.metadata.video_options, { durationSeconds: 5 });
  console.log('PASS: Pack 05 durable Video operation, lineage, options and asset history');
}

run().catch(error => { console.error(error); process.exit(1); });
