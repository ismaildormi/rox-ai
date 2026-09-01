'use strict';

const assert = require('assert');
const {
  MAX_TURN_START_MESSAGE_COUNT,
  getLatestUserMessage,
  inspectConversationTurn,
  compactBestEffort,
  prepareConversationTurn,
  completeConversationTurn
} = require('./lib/conversationTurn');

const CONVERSATION_ID =
  '11111111-1111-4111-8111-111111111111';

const TURN_ID =
  '22222222-2222-4222-8222-222222222222';

const ATTACHMENT_ID =
  '33333333-3333-4333-8333-333333333333';

async function run() {
  assert.strictEqual(
    MAX_TURN_START_MESSAGE_COUNT,
    998
  );

  assert.deepStrictEqual(
    getLatestUserMessage([
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Answer' },
      { role: 'user', content: 'Latest question' }
    ]),
    {
      role: 'user',
      content: 'Latest question'
    }
  );

  assert.throws(
    () => getLatestUserMessage([]),
    /conversation_user_message_missing/
  );

  const calls = [];

  const store = {
    async requireOwnedConversation(conversationId, ownerId) {
      calls.push(['owned', conversationId, ownerId]);

      return {
        id: conversationId,
        owner_id: ownerId,
        feature: 'chat',
        message_count: 20
      };
    },

    async appendMessage(input) {
      calls.push(['append', input]);

      return {
        id: `message-${calls.length}`,
        sequence_no:
          input.role === 'user' ? 21 : 22,
        ...input
      };
    },

    async compactConversationMemory(input) {
      calls.push(['compact', input]);

      return {
        compacted: false
      };
    },

    async buildConversationContext(input) {
      calls.push(['context', input]);

      return {
        messages: [
          {
            role: 'system',
            content: 'Earlier durable memory'
          },
          {
            role: 'user',
            content: 'Latest question'
          }
        ]
      };
    }
  };

  const inspected = await inspectConversationTurn({
    store,
    conversationId: CONVERSATION_ID,
    ownerId: 'owner-123',
    feature: 'chat'
  });

  assert.strictEqual(inspected.feature, 'chat');

  const prepared = await prepareConversationTurn({
    store,
    conversationId: CONVERSATION_ID,
    ownerId: 'owner-123',
    feature: 'chat',
    messages: [
      {
        role: 'user',
        content: 'Latest question'
      }
    ],
    attachmentIds: [ATTACHMENT_ID],
    requestKey: TURN_ID
  });

  assert.strictEqual(
    prepared.providerMessages[0].role,
    'system'
  );

  const userAppend = calls.find(
    call =>
      call[0] === 'append' &&
      call[1].role === 'user'
  );

  assert.strictEqual(
    userAppend[1].requestId,
    `${TURN_ID}:user`
  );
  assert.deepStrictEqual(
    userAppend[1].metadata.attachment_ids,
    [ATTACHMENT_ID]
  );

  const completed = await completeConversationTurn({
    store,
    conversationId: CONVERSATION_ID,
    ownerId: 'owner-123',
    feature: 'code',
    text: '```js\nconsole.log("Rox");\n```',
    model: 'test-model',
    provider: 'test-provider',
    responseId: 'response-123',
    requestKey: TURN_ID
  });

  assert.strictEqual(completed.messageType, 'code');
  assert.strictEqual(
    completed.requestId,
    `${TURN_ID}:assistant`
  );

  const limitStore = {
    async requireOwnedConversation() {
      return {
        feature: 'chat',
        message_count: 999
      };
    }
  };

  await assert.rejects(
    inspectConversationTurn({
      store: limitStore,
      conversationId: CONVERSATION_ID,
      ownerId: 'owner-123',
      feature: 'chat'
    }),
    error =>
      error.code === 'conversation_message_limit'
  );

  const mismatchStore = {
    async requireOwnedConversation() {
      return {
        feature: 'images',
        message_count: 0
      };
    }
  };

  await assert.rejects(
    inspectConversationTurn({
      store: mismatchStore,
      conversationId: CONVERSATION_ID,
      ownerId: 'owner-123',
      feature: 'chat'
    }),
    error =>
      error.code === 'conversation_feature_mismatch'
  );

  const logged = [];

  const compactResult = await compactBestEffort({
    store: {
      async compactConversationMemory() {
        throw new Error('temporary_database_error');
      }
    },
    conversationId: CONVERSATION_ID,
    ownerId: 'owner-123',
    logger: {
      error(...args) {
        logged.push(args);
      }
    }
  });

  assert.strictEqual(compactResult.failed, true);
  assert.strictEqual(logged.length, 1);

  const legacy = await prepareConversationTurn({
    store,
    conversationId: null,
    ownerId: 'owner-123',
    feature: 'chat',
    messages: [{
      role: 'user',
      content: 'Legacy request'
    }],
    requestKey: TURN_ID
  });

  assert.strictEqual(legacy.conversation, null);
  assert.strictEqual(
    legacy.providerMessages[0].content,
    'Legacy request'
  );

  console.log(
    'PASS: conversation turn orchestration unit tests'
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
