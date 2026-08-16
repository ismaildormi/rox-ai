'use strict';

const assert = require('assert');

const {
  MAX_ROXIP_COMMAND_CHARS,
  MAX_ROXIP_RESPONSE_CHARS,
  MAX_ROXIP_REQUEST_KEY_CHARS,
  recordRoxIpDemoTurn
} = require('./lib/conversationRoxIp');

const conversationId =
  '11111111-1111-4111-8111-111111111111';
const ownerId =
  '22222222-2222-4222-8222-222222222222';
const requestKey =
  '33333333-3333-4333-8333-333333333333';

function createStore({
  feature = 'roxip',
  messageCount = 0,
  compactError = null
} = {}) {
  const calls = {
    requireOwnedConversation: [],
    appendMessage: [],
    compactConversationMemory: []
  };

  const store = {
    async requireOwnedConversation(id, owner) {
      calls.requireOwnedConversation.push({ id, owner });

      return {
        id,
        owner_id: owner,
        feature,
        message_count: messageCount
      };
    },

    async appendMessage(message) {
      calls.appendMessage.push(message);

      return {
        id: calls.appendMessage.length,
        ...message
      };
    },

    async compactConversationMemory(input) {
      calls.compactConversationMemory.push(input);

      if (compactError) {
        throw compactError;
      }

      return {
        compacted: false
      };
    }
  };

  return { store, calls };
}

async function run() {
  assert.strictEqual(MAX_ROXIP_COMMAND_CHARS, 2000);
  assert.strictEqual(MAX_ROXIP_RESPONSE_CHARS, 8000);
  assert.strictEqual(MAX_ROXIP_REQUEST_KEY_CHARS, 128);

  const { store, calls } = createStore();

  const result = await recordRoxIpDemoTurn({
    store,
    conversationId,
    ownerId,
    command: 'Open the browser',
    responseText:
      'Rox IP is in demo mode. No device action was performed.',
    requestKey
  });

  assert.strictEqual(
    calls.requireOwnedConversation.length,
    1
  );

  assert.deepStrictEqual(
    calls.requireOwnedConversation[0],
    {
      id: conversationId,
      owner: ownerId
    }
  );

  assert.strictEqual(calls.appendMessage.length, 2);

  const userMessage = calls.appendMessage[0];
  const assistantMessage = calls.appendMessage[1];

  assert.strictEqual(userMessage.role, 'user');
  assert.strictEqual(userMessage.messageType, 'roxip_event');
  assert.strictEqual(
    userMessage.requestId,
    `${requestKey}:user`
  );
  assert.strictEqual(
    userMessage.content.deviceActionExecuted,
    false
  );
  assert.strictEqual(
    userMessage.metadata.roxip_mode,
    'demo'
  );

  assert.strictEqual(assistantMessage.role, 'assistant');
  assert.strictEqual(
    assistantMessage.messageType,
    'roxip_event'
  );
  assert.strictEqual(
    assistantMessage.requestId,
    `${requestKey}:assistant`
  );
  assert.strictEqual(
    assistantMessage.content.demoOnly,
    true
  );
  assert.strictEqual(
    assistantMessage.content.deviceActionExecuted,
    false
  );

  assert.strictEqual(
    assistantMessage.metadata.device_action_executed,
    false
  );

  assert.strictEqual(
    calls.compactConversationMemory.length,
    1
  );

  assert.strictEqual(result.demoOnly, true);
  assert.strictEqual(
    result.deviceActionExecuted,
    false
  );
  assert.strictEqual(result.userMessage.id, 1);
  assert.strictEqual(result.assistantMessage.id, 2);

  const noConversation = createStore();

  const noConversationResult =
    await recordRoxIpDemoTurn({
      store: noConversation.store,
      conversationId: null,
      ownerId,
      command: 'Ignored',
      responseText: 'Ignored',
      requestKey
    });

  assert.strictEqual(noConversationResult, null);
  assert.strictEqual(
    noConversation.calls.appendMessage.length,
    0
  );

  const wrongFeature = createStore({
    feature: 'chat'
  });

  await assert.rejects(
    recordRoxIpDemoTurn({
      store: wrongFeature.store,
      conversationId,
      ownerId,
      command: 'Open settings',
      responseText: 'Demo only',
      requestKey
    }),
    error =>
      error.code === 'conversation_feature_mismatch'
  );

  const fullConversation = createStore({
    messageCount: 999
  });

  await assert.rejects(
    recordRoxIpDemoTurn({
      store: fullConversation.store,
      conversationId,
      ownerId,
      command: 'Open settings',
      responseText: 'Demo only',
      requestKey
    }),
    error =>
      error.code === 'conversation_message_limit'
  );

  await assert.rejects(
    recordRoxIpDemoTurn({
      store,
      conversationId,
      ownerId,
      command: '',
      responseText: 'Demo only',
      requestKey
    }),
    error =>
      error.code === 'roxip_command_required'
  );

  await assert.rejects(
    recordRoxIpDemoTurn({
      store,
      conversationId,
      ownerId,
      command: 'Open settings',
      responseText: '',
      requestKey
    }),
    error =>
      error.code === 'roxip_response_required'
  );

  await assert.rejects(
    recordRoxIpDemoTurn({
      store,
      conversationId,
      ownerId,
      command: 'x'.repeat(
        MAX_ROXIP_COMMAND_CHARS + 1
      ),
      responseText: 'Demo only',
      requestKey
    }),
    error =>
      error.code === 'roxip_command_required_too_long'
  );

  await assert.rejects(
    recordRoxIpDemoTurn({
      store,
      conversationId,
      ownerId,
      command: 'Open settings',
      responseText: 'Demo only',
      requestKey:
        'x'.repeat(MAX_ROXIP_REQUEST_KEY_CHARS + 1)
    }),
    error =>
      error.code === 'roxip_request_key_required_too_long'
  );

  const compactionLogs = [];
  const compactionFailure = createStore({
    compactError: new Error('temporary_db_issue')
  });

  const resilientResult =
    await recordRoxIpDemoTurn({
      store: compactionFailure.store,
      conversationId,
      ownerId,
      command: 'Open the browser',
      responseText: 'Demo only',
      requestKey,
      logger: {
        error(...args) {
          compactionLogs.push(args);
        }
      }
    });

  assert.strictEqual(resilientResult.demoOnly, true);
  assert.strictEqual(compactionLogs.length, 1);

  console.log(
    'PASS: Rox IP demo conversation memory unit tests'
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});