'use strict';

let lazyDefaultStore = null;

const CONVERSATION_FEATURES =
  new Set(['chat', 'code', 'images', 'videos', 'roxip']);

const MESSAGE_ROLES =
  new Set(['user', 'assistant', 'system', 'tool']);

const MESSAGE_TYPES =
  new Set([
    'text',
    'code',
    'image',
    'video',
    'audio',
    'file',
    'roxip_event',
    'status'
  ]);

const MAX_CONVERSATION_MESSAGES = 1000;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const PROVIDER_RECENT_MESSAGE_LIMIT = 24;
const PROVIDER_CONTEXT_CHAR_LIMIT = 18000;
const MEMORY_SUMMARY_CHAR_LIMIT = 10000;
const MEMORY_COMPACTION_BATCH = 200;

function normalizeFeature(value) {
  const feature = String(value || 'chat').trim().toLowerCase();

  if (feature === 'image') return 'images';
  if (feature === 'video') return 'videos';

  return CONVERSATION_FEATURES.has(feature)
    ? feature
    : 'chat';
}

function normalizeTitle(value, fallback = 'New conversation') {
  const title = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  return title || fallback;
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();

  if (!MESSAGE_ROLES.has(role)) {
    throw new Error('invalid_conversation_role');
  }

  return role;
}

function normalizeMessageType(value) {
  const messageType = String(value || 'text')
    .trim()
    .toLowerCase();

  if (!MESSAGE_TYPES.has(messageType)) {
    throw new Error('invalid_conversation_message_type');
  }

  return messageType;
}

function clampListLimit(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return DEFAULT_LIST_LIMIT;

  return Math.max(
    1,
    Math.min(MAX_LIST_LIMIT, Math.floor(parsed))
  );
}

function buildRollingSummary(
  existingSummary,
  messages,
  maximumCharacters = MEMORY_SUMMARY_CHAR_LIMIT
) {
  const prior = String(existingSummary || '').trim();

  const additions = (Array.isArray(messages) ? messages : [])
    .map(message => {
      const text = String(message?.plain_text || '').trim();

      if (!text) return '';

      const label =
        message.role === 'user' ? 'User' :
        message.role === 'assistant' ? 'Rox' :
        message.role === 'tool' ? 'Tool' :
        'System';

      return `${label}: ${text.slice(0, 700)}`;
    })
    .filter(Boolean);

  const combined = [prior, ...additions]
    .filter(Boolean)
    .join('\n');

  if (combined.length <= maximumCharacters) {
    return combined;
  }

  return combined.slice(combined.length - maximumCharacters);
}

function mergeConsecutiveProviderRoles(messages) {
  const merged = [];

  for (const message of messages) {
    const role = message.role;
    const content = String(message.content || '').trim();

    if (!content) continue;

    const previous = merged[merged.length - 1];

    if (previous && previous.role === role) {
      previous.content += `\n\n${content}`;
    } else {
      merged.push({ role, content });
    }
  }

  return merged;
}

function buildProviderMessages({
  summary = '',
  messages = [],
  maxMessages = PROVIDER_RECENT_MESSAGE_LIMIT,
  maxCharacters = PROVIDER_CONTEXT_CHAR_LIMIT
} = {}) {
  const candidates = (Array.isArray(messages) ? messages : [])
    .filter(message =>
      message &&
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.plain_text === 'string' &&
      message.plain_text.trim()
    )
    .map(message => ({
      role: message.role,
      content: message.plain_text.trim()
    }));

  const selected = [];
  let usedCharacters = 0;

  for (
    let index = candidates.length - 1;
    index >= 0 && selected.length < maxMessages;
    index--
  ) {
    const candidate = candidates[index];

    if (
      selected.length > 0 &&
      usedCharacters + candidate.content.length > maxCharacters
    ) {
      break;
    }

    selected.unshift(candidate);
    usedCharacters += candidate.content.length;
  }

  const merged = mergeConsecutiveProviderRoles(selected);
  const memory = String(summary || '').trim();

  if (!memory) return merged;

  const boundedMemory = memory.slice(-Math.min(10000, maxCharacters));

  return [
    {
      role: 'system',
      content:
        'Durable Rox conversation memory from earlier turns:\n' +
        boundedMemory
    },
    ...merged
  ];
}

function createConversationStore(db) {
  if (!db || typeof db.from !== 'function') {
    throw new TypeError('createConversationStore requires a Supabase-compatible database client.');
  }
  async function requireOwnedConversation(conversationId, ownerId) {
    const { data, error } = await db
      .from('shared_conversations')
      .select(
        'id, owner_id, title, feature, pinned, pinned_at, archived, ' +
        'message_count, memory_summary, memory_state, metadata, ' +
        'created_at, updated_at, last_message_at, content'
      )
      .eq('id', conversationId)
      .eq('owner_id', ownerId)
      .single();

    if (error || !data) {
      const notFound = new Error('conversation_not_found');
      notFound.cause = error || null;
      throw notFound;
    }

    return data;
  }

  async function createConversation({
    ownerId,
    feature,
    title,
    metadata = {}
  }) {
    const normalizedFeature = normalizeFeature(feature);

    const { data, error } = await db
      .from('shared_conversations')
      .insert({
        owner_id: ownerId,
        is_public: false,
        title: normalizeTitle(title),
        feature: normalizedFeature,
        pinned: false,
        archived: false,
        message_count: 0,
        memory_summary: '',
        memory_state: {
          version: 1,
          last_summarized_sequence: 0
        },
        metadata: {
          ...metadata,
          memory_version: 1
        },
        content: {
          version: 2,
          feature: normalizedFeature
        }
      })
      .select(
        'id, title, feature, pinned, pinned_at, archived, message_count, ' +
        'created_at, updated_at, last_message_at'
      )
      .single();

    if (error || !data) {
      const creationError = new Error('conversation_create_failed');
      creationError.cause = error || null;
      throw creationError;
    }

    return data;
  }

  async function listConversations({
    ownerId,
    feature,
    search,
    archived = false,
    limit
  }) {
    let query = db
      .from('shared_conversations')
      .select(
        'id, title, feature, pinned, pinned_at, archived, message_count, ' +
        'metadata, created_at, updated_at, last_message_at'
      )
      .eq('owner_id', ownerId)
      .eq('archived', Boolean(archived))
      .order('pinned', { ascending: false })
      .order('pinned_at', { ascending: false })
      .order('last_message_at', { ascending: false })
      .limit(clampListLimit(limit));

    if (feature) {
      query = query.eq('feature', normalizeFeature(feature));
    }

    const normalizedSearch = String(search || '')
      .replace(/[%_]/g, '')
      .trim()
      .slice(0, 80);

    if (normalizedSearch) {
      query = query.ilike('title', `%${normalizedSearch}%`);
    }

    const { data, error } = await query;

    if (error) {
      const listError = new Error('conversation_list_failed');
      listError.cause = error;
      throw listError;
    }

    return data || [];
  }

  async function updateConversation({
    conversationId,
    ownerId,
    title,
    pinned,
    archived
  }) {
    await requireOwnedConversation(conversationId, ownerId);

    const patch = {};

    if (title !== undefined) {
      patch.title = normalizeTitle(title);
    }

    if (pinned !== undefined) {
      const nextPinned = Boolean(pinned);
      patch.pinned = nextPinned;
      patch.pinned_at = nextPinned ? new Date().toISOString() : null;
    }

    if (archived !== undefined) {
      patch.archived = Boolean(archived);
    }

    if (!Object.keys(patch).length) {
      throw new Error('conversation_update_empty');
    }

    const { data, error } = await db
      .from('shared_conversations')
      .update(patch)
      .eq('id', conversationId)
      .eq('owner_id', ownerId)
      .select(
        'id, title, feature, pinned, pinned_at, archived, message_count, ' +
        'created_at, updated_at, last_message_at'
      )
      .single();

    if (error || !data) {
      const updateError = new Error('conversation_update_failed');
      updateError.cause = error || null;
      throw updateError;
    }

    return data;
  }

  async function appendMessage({
    conversationId,
    ownerId,
    role,
    messageType = 'text',
    plainText = '',
    content = {},
    metadata = {},
    provider = null,
    model = null,
    requestId = null
  }) {
    const { data, error } = await db.rpc(
      'rox_append_conversation_message',
      {
        p_conversation_id: conversationId,
        p_owner_id: ownerId,
        p_role: normalizeRole(role),
        p_message_type: normalizeMessageType(messageType),
        p_plain_text: String(plainText || ''),
        p_content:
          content && typeof content === 'object'
            ? content
            : {},
        p_metadata:
          metadata && typeof metadata === 'object'
            ? metadata
            : {},
        p_provider: provider,
        p_model: model,
        p_request_id: requestId
      }
    );

    if (error) {
      const message = String(error.message || '');

      if (message.includes('conversation_message_limit')) {
        const limitError = new Error('conversation_message_limit');
        limitError.code = 'conversation_message_limit';
        throw limitError;
      }

      if (message.includes('conversation_not_found')) {
        const notFound = new Error('conversation_not_found');
        notFound.code = 'conversation_not_found';
        throw notFound;
      }

      const appendError = new Error('conversation_append_failed');
      appendError.cause = error;
      throw appendError;
    }

    return Array.isArray(data) ? data[0] : data;
  }

  async function listMessages({
    conversationId,
    ownerId,
    beforeSequence,
    limit = 100
  }) {
    await requireOwnedConversation(conversationId, ownerId);

    let query = db
      .from('conversation_messages')
      .select(
        'id, sequence_no, role, message_type, plain_text, content, ' +
        'metadata, provider, model, request_id, created_at'
      )
      .eq('conversation_id', conversationId)
      .eq('owner_id', ownerId)
      .order('sequence_no', { ascending: false })
      .limit(clampListLimit(limit));

    const sequence = Number(beforeSequence);

    if (Number.isInteger(sequence) && sequence > 1) {
      query = query.lt('sequence_no', sequence);
    }

    const { data, error } = await query;

    if (error) {
      const messagesError = new Error('conversation_messages_failed');
      messagesError.cause = error;
      throw messagesError;
    }

    return (data || []).reverse();
  }

  async function compactConversationMemory({
    conversationId,
    ownerId
  }) {
    const conversation = await requireOwnedConversation(
      conversationId,
      ownerId
    );

    if (
      conversation.message_count <= PROVIDER_RECENT_MESSAGE_LIMIT
    ) {
      return {
        compacted: false,
        summary: conversation.memory_summary || ''
      };
    }

    const memoryState =
      conversation.memory_state &&
      typeof conversation.memory_state === 'object'
        ? conversation.memory_state
        : {};

    const lastSummarized =
      Number(memoryState.last_summarized_sequence) || 0;

    const cutoff =
      conversation.message_count -
      PROVIDER_RECENT_MESSAGE_LIMIT;

    if (cutoff <= lastSummarized) {
      return {
        compacted: false,
        summary: conversation.memory_summary || ''
      };
    }

    const { data, error } = await db
      .from('conversation_messages')
      .select('sequence_no, role, plain_text')
      .eq('conversation_id', conversationId)
      .eq('owner_id', ownerId)
      .gt('sequence_no', lastSummarized)
      .lte('sequence_no', cutoff)
      .order('sequence_no', { ascending: true })
      .limit(MEMORY_COMPACTION_BATCH);

    if (error) {
      const compactError = new Error(
        'conversation_compaction_load_failed'
      );
      compactError.cause = error;
      throw compactError;
    }

    const messages = data || [];

    if (!messages.length) {
      return {
        compacted: false,
        summary: conversation.memory_summary || ''
      };
    }

    const summary = buildRollingSummary(
      conversation.memory_summary,
      messages
    );

    const finalSequence =
      messages[messages.length - 1].sequence_no;

    const { error: updateError } = await db
      .from('shared_conversations')
      .update({
        memory_summary: summary,
        memory_state: {
          ...memoryState,
          version: 1,
          last_summarized_sequence: finalSequence
        }
      })
      .eq('id', conversationId)
      .eq('owner_id', ownerId);

    if (updateError) {
      const compactError = new Error(
        'conversation_compaction_update_failed'
      );
      compactError.cause = updateError;
      throw compactError;
    }

    return {
      compacted: true,
      summary,
      lastSummarizedSequence: finalSequence
    };
  }

  async function buildConversationContext({
    conversationId,
    ownerId
  }) {
    const conversation = await requireOwnedConversation(
      conversationId,
      ownerId
    );

    const messages = await listMessages({
      conversationId,
      ownerId,
      limit: PROVIDER_RECENT_MESSAGE_LIMIT
    });

    return {
      conversation,
      messages: buildProviderMessages({
        summary: conversation.memory_summary,
        messages
      })
    };
  }

  async function listAssets({
    conversationId,
    ownerId,
    scanStatus = null,
    limit = 100
  }) {
    await requireOwnedConversation(conversationId, ownerId);

    const parsedLimit = Number(limit);
    const safeLimit =
      Number.isInteger(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : 100;

    let assetQuery = db
      .from('conversation_assets')
      .select(
        'id, conversation_id, message_id, asset_type, url, ' +
        'storage_path, storage_bucket, mime_type, original_name, ' +
        'file_size_bytes, sha256, scan_status, extraction_status, ' +
        'metadata, created_at'
      )
      .eq('conversation_id', conversationId)
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })
      .limit(safeLimit);

    if (scanStatus) {
      assetQuery = assetQuery.eq(
        'scan_status',
        String(scanStatus).trim().toLowerCase()
      );
    }

    const { data, error } = await assetQuery;

    if (error) {
      const assetError = new Error('conversation_assets_list_failed');
      assetError.cause = error;
      throw assetError;
    }

    return Array.isArray(data) ? data : [];
  }

  async function addAsset({
    conversationId,
    messageId = null,
    ownerId,
    assetType,
    url = null,
    storagePath = null,
    storageBucket = null,
    mimeType = null,
    originalName = null,
    fileSizeBytes = null,
    sha256 = null,
    scanStatus = 'clean',
    extractionStatus = 'not_required',
    metadata = {}
  }) {
    await requireOwnedConversation(conversationId, ownerId);

    const normalizedAssetType = String(assetType || '')
      .trim()
      .toLowerCase();

    const allowedAssets =
      new Set(['image', 'video', 'audio', 'file', 'code', 'reference']);

    if (!allowedAssets.has(normalizedAssetType)) {
      throw new Error('invalid_conversation_asset_type');
    }

    if (!url && !storagePath) {
      throw new Error('conversation_asset_location_required');
    }

    const allowedScanStatuses =
      new Set(['pending', 'scanning', 'clean', 'rejected', 'failed']);

    const normalizedScanStatus =
      String(scanStatus || '').trim().toLowerCase();

    if (!allowedScanStatuses.has(normalizedScanStatus)) {
      throw new Error('invalid_conversation_asset_scan_status');
    }

    const allowedExtractionStatuses =
      new Set([
        'not_required',
        'pending',
        'processing',
        'ready',
        'unsupported',
        'failed'
      ]);

    const normalizedExtractionStatus =
      String(extractionStatus || '').trim().toLowerCase();

    if (!allowedExtractionStatuses.has(normalizedExtractionStatus)) {
      throw new Error('invalid_conversation_asset_extraction_status');
    }

    const normalizedFileSize =
      fileSizeBytes === null || fileSizeBytes === undefined
        ? null
        : Number(fileSizeBytes);

    if (
      normalizedFileSize !== null &&
      (
        !Number.isInteger(normalizedFileSize) ||
        normalizedFileSize < 0
      )
    ) {
      throw new Error('invalid_conversation_asset_file_size');
    }

    const normalizedSha256 =
      sha256 === null || sha256 === undefined || sha256 === ''
        ? null
        : String(sha256).trim().toLowerCase();

    if (
      normalizedSha256 !== null &&
      !/^[0-9a-f]{64}$/.test(normalizedSha256)
    ) {
      throw new Error('invalid_conversation_asset_sha256');
    }

    const assetPayload = {
      conversation_id: conversationId,
      message_id: messageId,
      owner_id: ownerId,
      asset_type: normalizedAssetType,
      url,
      storage_path: storagePath,
      storage_bucket: storageBucket,
      mime_type: mimeType,
      original_name: originalName,
      file_size_bytes: normalizedFileSize,
      sha256: normalizedSha256,
      scan_status: normalizedScanStatus,
      extraction_status: normalizedExtractionStatus,
      metadata:
        metadata && typeof metadata === 'object'
          ? metadata
          : {}
    };

    let assetWrite = db
      .from('conversation_assets');

    if (storageBucket && storagePath) {
      assetWrite = assetWrite.upsert(
        assetPayload,
        {
          onConflict:
            'storage_bucket,storage_path'
        }
      );
    } else if (messageId) {
      assetWrite = assetWrite.upsert(
        assetPayload,
        {
          onConflict:
            'conversation_id,message_id,asset_type'
        }
      );
    } else {
      assetWrite = assetWrite.insert(assetPayload);
    }

    const { data, error } = await assetWrite
      .select(
        'id, conversation_id, message_id, asset_type, url, ' +
        'storage_path, storage_bucket, mime_type, original_name, ' +
        'file_size_bytes, sha256, scan_status, extraction_status, ' +
        'metadata, created_at'
      )
      .single();

    if (error || !data) {
      const assetError = new Error('conversation_asset_create_failed');
      assetError.cause = error || null;
      throw assetError;
    }

    return data;
  }

  async function updateAssetProcessing({
    assetId,
    ownerId,
    scanStatus = undefined,
    extractionStatus = undefined,
    sha256 = undefined,
    metadata = undefined
  }) {
    const normalizedAssetId =
      String(assetId || '').trim();
    const normalizedOwnerId =
      String(ownerId || '').trim();

    if (!normalizedAssetId || !normalizedOwnerId) {
      throw new Error(
        'conversation_asset_update_identity_required'
      );
    }

    const patch = {};
    const allowedScanStatuses =
      new Set([
        'pending',
        'scanning',
        'clean',
        'rejected',
        'failed'
      ]);
    const allowedExtractionStatuses =
      new Set([
        'not_required',
        'pending',
        'processing',
        'ready',
        'unsupported',
        'failed'
      ]);

    if (scanStatus !== undefined) {
      const normalized =
        String(scanStatus || '').trim().toLowerCase();

      if (!allowedScanStatuses.has(normalized)) {
        throw new Error(
          'invalid_conversation_asset_scan_status'
        );
      }

      patch.scan_status = normalized;
    }

    if (extractionStatus !== undefined) {
      const normalized =
        String(extractionStatus || '')
          .trim()
          .toLowerCase();

      if (!allowedExtractionStatuses.has(normalized)) {
        throw new Error(
          'invalid_conversation_asset_extraction_status'
        );
      }

      patch.extraction_status = normalized;
    }

    if (sha256 !== undefined) {
      const normalized =
        sha256 === null || sha256 === ''
          ? null
          : String(sha256).trim().toLowerCase();

      if (
        normalized !== null &&
        !/^[0-9a-f]{64}$/.test(normalized)
      ) {
        throw new Error(
          'invalid_conversation_asset_sha256'
        );
      }

      patch.sha256 = normalized;
    }

    if (metadata !== undefined) {
      if (
        !metadata ||
        typeof metadata !== 'object' ||
        Array.isArray(metadata)
      ) {
        throw new Error(
          'invalid_conversation_asset_metadata'
        );
      }

      patch.metadata = metadata;
    }

    if (!Object.keys(patch).length) {
      throw new Error(
        'conversation_asset_update_empty'
      );
    }

    const { data, error } = await db
      .from('conversation_assets')
      .update(patch)
      .eq('id', normalizedAssetId)
      .eq('owner_id', normalizedOwnerId)
      .select(
        'id, conversation_id, message_id, asset_type, url, ' +
        'storage_path, storage_bucket, mime_type, original_name, ' +
        'file_size_bytes, sha256, scan_status, extraction_status, ' +
        'metadata, created_at'
      )
      .single();

    if (error || !data) {
      const assetError =
        new Error('conversation_asset_update_failed');
      assetError.cause = error || null;
      throw assetError;
    }

    return data;
  }
  async function replaceAssetChunks({
    assetId,
    conversationId,
    ownerId,
    chunks,
    batchSize = 100
  }) {
    const normalizedAssetId = String(assetId || '').trim();
    const normalizedConversationId =
      String(conversationId || '').trim();
    const normalizedOwnerId = String(ownerId || '').trim();
    const safeBatchSize = Math.min(
      250,
      Math.max(1, Number(batchSize) || 100)
    );

    if (
      !normalizedAssetId ||
      !normalizedConversationId ||
      !normalizedOwnerId
    ) {
      throw new Error('conversation_asset_chunk_identity_required');
    }

    if (
      !chunks ||
      (
        typeof chunks[Symbol.iterator] !== 'function' &&
        typeof chunks[Symbol.asyncIterator] !== 'function'
      )
    ) {
      throw new Error('conversation_asset_chunks_iterable_required');
    }

    const { error: deleteError } = await db
      .from('conversation_asset_chunks')
      .delete()
      .eq('asset_id', normalizedAssetId)
      .eq('owner_id', normalizedOwnerId);

    if (deleteError) {
      const chunkError =
        new Error('conversation_asset_chunks_clear_failed');
      chunkError.cause = deleteError;
      throw chunkError;
    }

    let batch = [];
    let expectedIndex = 0;
    let inserted = 0;

    async function flushBatch() {
      if (!batch.length) return;

      const { error } = await db
        .from('conversation_asset_chunks')
        .insert(batch);

      if (error) {
        const chunkError =
          new Error('conversation_asset_chunks_insert_failed');
        chunkError.cause = error;
        throw chunkError;
      }

      inserted += batch.length;
      batch = [];
    }

    for await (const raw of chunks) {
      const content = String(raw && raw.content || '');
      const chunkIndex = Number(raw && raw.chunkIndex);
      const charStart = Number(raw && raw.charStart);
      const charEnd = Number(raw && raw.charEnd);

      if (
        !Number.isInteger(chunkIndex) ||
        chunkIndex !== expectedIndex ||
        !Number.isInteger(charStart) ||
        charStart < 0 ||
        !Number.isInteger(charEnd) ||
        charEnd < charStart ||
        content.length < 1 ||
        content.length > 65536
      ) {
        throw new Error('invalid_conversation_asset_chunk');
      }

      batch.push({
        asset_id: normalizedAssetId,
        conversation_id: normalizedConversationId,
        owner_id: normalizedOwnerId,
        chunk_index: chunkIndex,
        char_start: charStart,
        char_end: charEnd,
        content,
        metadata:
          raw.metadata && typeof raw.metadata === 'object'
            ? raw.metadata
            : {}
      });

      expectedIndex += 1;

      if (batch.length >= safeBatchSize) {
        await flushBatch();
      }
    }

    await flushBatch();

    if (!inserted) {
      throw new Error('conversation_asset_chunks_empty');
    }

    return {
      assetId: normalizedAssetId,
      chunkCount: inserted
    };
  }

  async function searchAssetChunks({
    assetIds,
    ownerId,
    query = '',
    limit = 8
  }) {
    const ids = Array.isArray(assetIds)
      ? [...new Set(assetIds.map(id => String(id || '').trim()).filter(Boolean))]
      : [];
    const normalizedOwnerId = String(ownerId || '').trim();
    const safeLimit = Math.min(20, Math.max(1, Number(limit) || 8));

    if (!normalizedOwnerId || !ids.length) return [];

    const { data, error } = await db.rpc(
      'search_conversation_asset_chunks',
      {
        p_owner_id: normalizedOwnerId,
        p_asset_ids: ids,
        p_query: String(query || '').slice(0, 2000),
        p_limit: safeLimit
      }
    );

    if (error) {
      const chunkError =
        new Error('conversation_asset_chunks_search_failed');
      chunkError.cause = error;
      throw chunkError;
    }

    return Array.isArray(data) ? data : [];
  }

  return {
    createConversation,
    listConversations,
    requireOwnedConversation,
    updateConversation,
    appendMessage,
    listMessages,
    compactConversationMemory,
    buildConversationContext,
    listAssets,
    addAsset,
    updateAssetProcessing,
    replaceAssetChunks,
    searchAssetChunks
  };
}

function getDefaultStore() {
  if (!lazyDefaultStore) {
    const { supabaseAdmin } = require('./supabaseAdmin');
    lazyDefaultStore = createConversationStore(supabaseAdmin);
  }

  return lazyDefaultStore;
}

module.exports = {
  CONVERSATION_FEATURES,
  MESSAGE_ROLES,
  MESSAGE_TYPES,
  MAX_CONVERSATION_MESSAGES,
  PROVIDER_RECENT_MESSAGE_LIMIT,
  PROVIDER_CONTEXT_CHAR_LIMIT,
  normalizeFeature,
  normalizeTitle,
  normalizeRole,
  normalizeMessageType,
  clampListLimit,
  buildRollingSummary,
  buildProviderMessages,
  createConversationStore,
  createConversation: (...args) =>
    getDefaultStore().createConversation(...args),
  listConversations: (...args) =>
    getDefaultStore().listConversations(...args),
  requireOwnedConversation: (...args) =>
    getDefaultStore().requireOwnedConversation(...args),
  updateConversation: (...args) =>
    getDefaultStore().updateConversation(...args),
  appendMessage: (...args) =>
    getDefaultStore().appendMessage(...args),
  listMessages: (...args) =>
    getDefaultStore().listMessages(...args),
  compactConversationMemory: (...args) =>
    getDefaultStore().compactConversationMemory(...args),
  buildConversationContext: (...args) =>
    getDefaultStore().buildConversationContext(...args),
  listAssets: (...args) =>
    getDefaultStore().listAssets(...args),
  addAsset: (...args) =>
    getDefaultStore().addAsset(...args),
  updateAssetProcessing: (...args) =>
    getDefaultStore().updateAssetProcessing(...args),
  replaceAssetChunks: (...args) =>
    getDefaultStore().replaceAssetChunks(...args),
  searchAssetChunks: (...args) =>
    getDefaultStore().searchAssetChunks(...args)
};