'use strict';

const conversationMemory = require('./conversationMemory');

const MAX_TURN_START_MESSAGE_COUNT = 998;

function createTurnError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function getLatestUserMessage(messages) {
  if (!Array.isArray(messages)) {
    throw createTurnError('conversation_user_message_missing');
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (
      message &&
      message.role === 'user' &&
      typeof message.content === 'string' &&
      message.content.trim()
    ) {
      return {
        role: 'user',
        content: message.content
      };
    }
  }

  throw createTurnError('conversation_user_message_missing');
}

async function inspectConversationTurn({
  store = conversationMemory,
  conversationId,
  ownerId,
  feature
}) {
  if (!conversationId) return null;

  const conversation =
    await store.requireOwnedConversation(
      conversationId,
      ownerId
    );

  if (
    conversationMemory.normalizeFeature(conversation.feature) !==
    conversationMemory.normalizeFeature(feature)
  ) {
    throw createTurnError('conversation_feature_mismatch');
  }

  const messageCount =
    Number(conversation.message_count) || 0;

  if (messageCount > MAX_TURN_START_MESSAGE_COUNT) {
    throw createTurnError('conversation_message_limit');
  }

  return conversation;
}

async function compactBestEffort({
  store,
  conversationId,
  ownerId,
  logger = console
}) {
  try {
    return await store.compactConversationMemory({
      conversationId,
      ownerId
    });
  } catch (error) {
    logger.error(
      '[conversation-memory] compaction failed:',
      error && error.message ? error.message : error
    );

    return {
      compacted: false,
      failed: true
    };
  }
}

async function prepareConversationTurn({
  store = conversationMemory,
  conversationId,
  ownerId,
  feature,
  messages,
  requestKey,
  logger = console
}) {
  const conversation = await inspectConversationTurn({
    store,
    conversationId,
    ownerId,
    feature
  });

  if (!conversation) {
    return {
      conversation: null,
      providerMessages: messages
    };
  }

  const latestUser = getLatestUserMessage(messages);

  const userMessage = await store.appendMessage({
    conversationId,
    ownerId,
    role: 'user',
    messageType: 'text',
    plainText: latestUser.content,
    content: {
      text: latestUser.content
    },
    metadata: {
      turn_role: 'user'
    },
    requestId: `${requestKey}:user`
  });

  await compactBestEffort({
    store,
    conversationId,
    ownerId,
    logger
  });

  const context = await store.buildConversationContext({
    conversationId,
    ownerId
  });

  return {
    conversation,
    userMessage,
    providerMessages: context.messages
  };
}

async function completeConversationTurn({
  store = conversationMemory,
  conversationId,
  ownerId,
  feature,
  text,
  model,
  provider = null,
  responseId,
  requestKey,
  logger = console
}) {
  if (!conversationId) {
    return null;
  }

  const assistantMessage = await store.appendMessage({
    conversationId,
    ownerId,
    role: 'assistant',
    messageType:
      conversationMemory.normalizeFeature(feature) === 'code'
        ? 'code'
        : 'text',
    plainText: String(text || ''),
    content: {
      text: String(text || ''),
      responseId: responseId || null
    },
    metadata: {
      turn_role: 'assistant'
    },
    provider,
    model: model || null,
    requestId: `${requestKey}:assistant`
  });

  await compactBestEffort({
    store,
    conversationId,
    ownerId,
    logger
  });

  return assistantMessage;
}

module.exports = {
  MAX_TURN_START_MESSAGE_COUNT,
  getLatestUserMessage,
  inspectConversationTurn,
  compactBestEffort,
  prepareConversationTurn,
  completeConversationTurn
};
