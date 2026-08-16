'use strict';

const assert = require('assert');
const {
  normalizeGenerationFeature,
  prepareGenerationConversation,
  completeGenerationConversation,
  failGenerationConversation
} = require('./lib/conversationGeneration');

const CONVERSATION_ID =
  '11111111-1111-4111-8111-111111111111';

const TURN_ID =
  '22222222-2222-4222-8222-222222222222';

async function run() {
  assert.strictEqual(
    normalizeGenerationFeature('image'),
    'images'
  );

  assert.strictEqual(
    normalizeGenerationFeature('video'),
    'videos'
  );

  assert.throws(
    () => normalizeGenerationFeature('chat'),
    /invalid_generation_conversation_feature/
  );

  const calls = [];

  const store = {
    async requireOwnedConversation() {
      return {
        id: CONVERSATION_ID,
        feature: 'images',
        message_count: 0
      };
    },

    async appendMessage(input) {
      calls.push(['append', input]);

      return {
        id:
          input.role === 'user'
            ? 101
            : 102,
        sequence_no:
          input.role === 'user'
            ? 1
            : 2,
        ...input
      };
    },

    async addAsset(input) {
      calls.push(['asset', input]);

      return {
        id: 'asset-1',
        ...input
      };
    },

    async compactConversationMemory(input) {
      calls.push(['compact', input]);

      return {
        compacted: false
      };
    }
  };

  const promptMessage =
    await prepareGenerationConversation({
      store,
      conversationId: CONVERSATION_ID,
      ownerId: 'owner-123',
      feature: 'image',
      prompt: 'A cinematic Moroccan city',
      requestKey: TURN_ID
    });

  assert.strictEqual(promptMessage.id, 101);
  assert.strictEqual(
    promptMessage.requestId,
    `${TURN_ID}:user`
  );

  const completed =
    await completeGenerationConversation({
      store,
      conversationId: CONVERSATION_ID,
      ownerId: 'owner-123',
      feature: 'image',
      resultUrl: 'https://example.com/result.png',
      requestKey: TURN_ID,
      provider: 'test-provider',
      model: 'test-image-model'
    });

  assert.strictEqual(
    completed.assistantMessage.messageType,
    'image'
  );

  assert.strictEqual(
    completed.assistantMessage.requestId,
    `${TURN_ID}:assistant`
  );

  assert.strictEqual(
    completed.asset.messageId,
    completed.assistantMessage.id
  );

  assert.strictEqual(
    completed.asset.url,
    'https://example.com/result.png'
  );

  const videoStore = {
    ...store,

    async requireOwnedConversation() {
      return {
        id: CONVERSATION_ID,
        feature: 'videos',
        message_count: 20
      };
    }
  };

  const videoCompleted =
    await completeGenerationConversation({
      store: videoStore,
      conversationId: CONVERSATION_ID,
      ownerId: 'owner-123',
      feature: 'video',
      resultUrl: 'https://example.com/result.mp4',
      requestKey: TURN_ID
    });

  assert.strictEqual(
    videoCompleted.assistantMessage.messageType,
    'video'
  );

  const failure =
    await failGenerationConversation({
      store: videoStore,
      conversationId: CONVERSATION_ID,
      ownerId: 'owner-123',
      feature: 'video',
      errorMessage: 'provider_failed',
      requestKey: 'failure-turn'
    });

  assert.strictEqual(
    failure.messageType,
    'status'
  );

  assert.strictEqual(
    failure.content.generationStatus,
    'failed'
  );

  const legacy =
    await prepareGenerationConversation({
      store,
      conversationId: null,
      ownerId: 'owner-123',
      feature: 'image',
      prompt: 'Legacy prompt',
      requestKey: TURN_ID
    });

  assert.strictEqual(legacy, null);

  console.log(
    'PASS: image and video conversation memory unit tests'
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
