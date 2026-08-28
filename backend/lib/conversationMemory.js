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

  async function addAsset({
    conversationId,
    messageId = null,
    ownerId,
    assetType,
    url = null,
    storagePath = null,
    mimeType = null,
    originalName = null,
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

    const assetPayload = {
      conversation_id: conversationId,
      message_id: messageId,
      owner_id: ownerId,
      asset_type: normalizedAssetType,
      url,
      storage_path: storagePath,
      mime_type: mimeType,
      original_name: originalName,
      metadata:
        metadata && typeof metadata === 'object'
          ? metadata
          : {}
    };

    let assetWrite = db
      .from('conversation_assets');

    if (messageId) {
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
        'storage_path, mime_type, original_name, metadata, created_at'
      )
      .single();

    if (error || !data) {
      const assetError = new Error('conversation_asset_create_failed');
      assetError.cause = error || null;
      throw assetError;
    }

    return data;
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
    addAsset
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
  addAsset: (...args) =>
    getDefaultStore().addAsset(...args)
};