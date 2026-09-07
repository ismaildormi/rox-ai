'use strict';

const conversationMemory = require('./conversationMemory');
const {
  inspectConversationTurn,
  compactBestEffort
} = require('./conversationTurn');

function normalizeGenerationFeature(feature) {
  const normalized =
    conversationMemory.normalizeFeature(feature);

  if (
    normalized !== 'images' &&
    normalized !== 'videos'
  ) {
    const error =
      new Error('invalid_generation_conversation_feature');

    error.code =
      'invalid_generation_conversation_feature';

    throw error;
  }

  return normalized;
}

async function prepareGenerationConversation({
  store = conversationMemory,
  conversationId,
  ownerId,
  feature,
  prompt,
  operation = 'generate',
  referenceAssetIds = [],
  sourceAssetId = null,
  maskAssetId = null,
  imageOptions = {},
  sourceImageAssetId = null,
  sourceVideoAssetId = null,
  startFrameAssetId = null,
  endFrameAssetId = null,
  videoOptions = {},
  requestKey
}) {
  if (!conversationId) return null;

  const normalizedFeature =
    normalizeGenerationFeature(feature);

  await inspectConversationTurn({
    store,
    conversationId,
    ownerId,
    feature: normalizedFeature
  });

  return store.appendMessage({
    conversationId,
    ownerId,
    role: 'user',
    messageType: 'text',
    plainText: String(prompt || ''),
    content: {
      text: String(prompt || ''),
      generationFeature: normalizedFeature,
      operation,
      referenceAssetIds,
      sourceAssetId,
      maskAssetId,
      imageOptions,
      sourceImageAssetId,
      sourceVideoAssetId,
      startFrameAssetId,
      endFrameAssetId,
      videoOptions
    },
    metadata: {
      turn_role: 'user',
      generation_status: 'queued'
    },
    requestId: `${requestKey}:user`
  });
}

async function completeGenerationConversation({
  store = conversationMemory,
  conversationId,
  ownerId,
  feature,
  resultUrl,
  requestKey,
  provider = null,
  model = null,
  operation = 'generate',
  referenceAssetIds = [],
  sourceAssetId = null,
  maskAssetId = null,
  imageOptions = {},
  sourceImageAssetId = null,
  sourceVideoAssetId = null,
  startFrameAssetId = null,
  endFrameAssetId = null,
  videoOptions = {},
  logger = console
}) {
  if (!conversationId) return null;

  const normalizedFeature =
    normalizeGenerationFeature(feature);

  const assetType =
    normalizedFeature === 'videos'
      ? 'video'
      : 'image';

  const assistantMessage =
    await store.appendMessage({
      conversationId,
      ownerId,
      role: 'assistant',
      messageType: assetType,
      plainText: '',
      content: {
        url: resultUrl,
        assetType,
        generationStatus: 'done',
        operation,
        lineage: {
          referenceAssetIds,
          sourceAssetId,
          maskAssetId,
          sourceImageAssetId,
          sourceVideoAssetId,
          startFrameAssetId,
          endFrameAssetId
        },
        imageOptions,
        videoOptions
      },
      metadata: {
        turn_role: 'assistant',
        generation_status: 'done'
      },
      provider,
      model,
      requestId: `${requestKey}:assistant`
    });

  const asset = await store.addAsset({
    conversationId,
    messageId: assistantMessage.id,
    ownerId,
    assetType,
    url: resultUrl,
    metadata: {
      generation_status: 'done',
      request_key: requestKey,
      operation,
      reference_asset_ids: referenceAssetIds,
      source_asset_id: sourceAssetId,
      mask_asset_id: maskAssetId,
      image_options: imageOptions,
      source_image_asset_id: sourceImageAssetId,
      source_video_asset_id: sourceVideoAssetId,
      start_frame_asset_id: startFrameAssetId,
      end_frame_asset_id: endFrameAssetId,
      video_options: videoOptions
    }
  });

  await compactBestEffort({
    store,
    conversationId,
    ownerId,
    logger
  });

  return {
    assistantMessage,
    asset
  };
}

async function failGenerationConversation({
  store = conversationMemory,
  conversationId,
  ownerId,
  feature,
  errorMessage,
  requestKey,
  logger = console
}) {
  if (!conversationId) return null;

  const normalizedFeature =
    normalizeGenerationFeature(feature);

  const failureMessage =
    await store.appendMessage({
      conversationId,
      ownerId,
      role: 'assistant',
      messageType: 'status',
      plainText: String(errorMessage || 'generation_failed'),
      content: {
        generationFeature: normalizedFeature,
        generationStatus: 'failed',
        error: String(errorMessage || 'generation_failed')
      },
      metadata: {
        turn_role: 'assistant',
        generation_status: 'failed'
      },
      requestId: `${requestKey}:assistant`
    });

  await compactBestEffort({
    store,
    conversationId,
    ownerId,
    logger
  });

  return failureMessage;
}

module.exports = {
  normalizeGenerationFeature,
  prepareGenerationConversation,
  completeGenerationConversation,
  failGenerationConversation
};
