'use strict';

const conversationMemory = require('./conversationMemory');
const {
  inspectConversationTurn
} = require('./conversationTurn');

const MAX_ROXIP_COMMAND_CHARS = 2000;
const MAX_ROXIP_RESPONSE_CHARS = 8000;
const MAX_ROXIP_REQUEST_KEY_CHARS = 128;

function createRoxIpError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeRequiredText(value, code, maxCharacters) {
  const text = String(value || '').trim();

  if (!text) {
    throw createRoxIpError(code);
  }

  if (text.length > maxCharacters) {
    throw createRoxIpError(`${code}_too_long`);
  }

  return text;
}

async function compactRoxIpBestEffort({
  store,
  conversationId,
  ownerId,
  logger = console
}) {
  try {
    await store.compactConversationMemory({
      conversationId,
      ownerId
    });
  } catch (error) {
    logger.error(
      '[roxip-memory] compaction failed:',
      error && error.message ? error.message : error
    );
  }
}

async function recordRoxIpDemoTurn({
  store = conversationMemory,
  conversationId,
  ownerId,
  command,
  responseText,
  requestKey,
  logger = console
}) {
  if (!conversationId) return null;

  const normalizedCommand = normalizeRequiredText(
    command,
    'roxip_command_required',
    MAX_ROXIP_COMMAND_CHARS
  );

  const normalizedResponse = normalizeRequiredText(
    responseText,
    'roxip_response_required',
    MAX_ROXIP_RESPONSE_CHARS
  );

  const normalizedRequestKey = normalizeRequiredText(
    requestKey,
    'roxip_request_key_required',
    MAX_ROXIP_REQUEST_KEY_CHARS
  );

  const conversation = await inspectConversationTurn({
    store,
    conversationId,
    ownerId,
    feature: 'roxip'
  });

  const userMessage = await store.appendMessage({
    conversationId,
    ownerId,
    role: 'user',
    messageType: 'roxip_event',
    plainText: normalizedCommand,
    content: {
      command: normalizedCommand,
      eventType: 'demo_command_received',
      deviceActionExecuted: false
    },
    metadata: {
      turn_role: 'user',
      roxip_mode: 'demo',
      device_action_executed: false
    },
    requestId: `${normalizedRequestKey}:user`
  });

  const assistantMessage = await store.appendMessage({
    conversationId,
    ownerId,
    role: 'assistant',
    messageType: 'roxip_event',
    plainText: normalizedResponse,
    content: {
      text: normalizedResponse,
      eventType: 'demo_only',
      demoOnly: true,
      deviceActionExecuted: false
    },
    metadata: {
      turn_role: 'assistant',
      roxip_mode: 'demo',
      device_action_executed: false
    },
    requestId: `${normalizedRequestKey}:assistant`
  });

  await compactRoxIpBestEffort({
    store,
    conversationId,
    ownerId,
    logger
  });

  return {
    conversation,
    userMessage,
    assistantMessage,
    demoOnly: true,
    deviceActionExecuted: false
  };
}

module.exports = {
  MAX_ROXIP_COMMAND_CHARS,
  MAX_ROXIP_RESPONSE_CHARS,
  MAX_ROXIP_REQUEST_KEY_CHARS,
  recordRoxIpDemoTurn
};