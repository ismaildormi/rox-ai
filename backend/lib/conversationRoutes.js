'use strict';

const express = require('express');
const conversationMemory = require('./conversationMemory');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isConversationId(value) {
  return UUID_PATTERN.test(String(value || ''));
}

function sendConversationError(res, error, operation) {
  const code = String(error && (error.code || error.message) || '');

  if (code === 'conversation_not_found') {
    return res.status(404).json({
      status: 'error',
      code,
      message: 'Conversation not found.'
    });
  }

  if (
    code === 'conversation_update_empty' ||
    code === 'invalid_conversation_feature' ||
    code === 'invalid_conversation_id'
  ) {
    return res.status(400).json({
      status: 'error',
      code,
      message: 'Invalid conversation request.'
    });
  }

  console.error(
    `[conversation-api] ${operation} failed:`,
    error && error.message ? error.message : error
  );

  return res.status(500).json({
    status: 'error',
    code: 'conversation_request_failed',
    message: 'Conversation request could not be completed.'
  });
}

function createConversationRouter({
  store = conversationMemory
} = {}) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const items = await store.listConversations({
        ownerId: req.userId,
        feature: req.query.feature,
        search: req.query.search,
        archived: req.query.archived === 'true',
        limit: req.query.limit
      });

      return res.json({
        status: 'success',
        items
      });
    } catch (error) {
      return sendConversationError(
        res,
        error,
        'list'
      );
    }
  });

  router.post('/', async (req, res) => {
    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body
        : {};

    if (
      !conversationMemory.CONVERSATION_FEATURES.has(
        String(body.feature || '').toLowerCase()
      )
    ) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_conversation_feature',
        message: 'feature must be one of: chat, code, images, videos, roxip.'
      });
    }

    if (
      body.title !== undefined &&
      typeof body.title !== 'string'
    ) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_conversation_title',
        message: 'title must be a string.'
      });
    }

    try {
      const conversation = await store.createConversation({
        ownerId: req.userId,
        feature: body.feature,
        title: body.title,
        metadata:
          body.metadata &&
          typeof body.metadata === 'object' &&
          !Array.isArray(body.metadata)
            ? body.metadata
            : {}
      });

      return res.status(201).json({
        status: 'success',
        conversation
      });
    } catch (error) {
      return sendConversationError(
        res,
        error,
        'create'
      );
    }
  });

  router.post('/:conversationId/branch', async (req, res) => {
    if (!isConversationId(req.params.conversationId)) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_conversation_id',
        message: 'Invalid conversation id.'
      });
    }

    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body
        : {};

    const throughSequence =
      body.throughSequence === undefined
        ? null
        : Number(body.throughSequence);

    if (
      throughSequence !== null &&
      (!Number.isInteger(throughSequence) || throughSequence < 1)
    ) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_branch_sequence',
        message: 'Invalid branch sequence.'
      });
    }

    try {
      const source = await store.requireOwnedConversation(
        req.params.conversationId,
        req.userId
      );

      let messages = [];
      let beforeSequence;

      while (messages.length < 1000) {
        const page = await store.listMessages({
          conversationId: source.id,
          ownerId: req.userId,
          beforeSequence,
          limit: 100
        });

        if (!page.length) break;

        messages = [...page,...messages];

        if (page.length < 100) break;

        const nextBefore = Number(page[0].sequence_no);

        if (
          !Number.isInteger(nextBefore) ||
          nextBefore < 2 ||
          nextBefore === beforeSequence
        ) break;

        beforeSequence = nextBefore;
      }

      const selected = throughSequence === null
        ? messages
        : messages.filter(
            message =>
              Number(message.sequence_no) <= throughSequence
          );

      const conversation = await store.createConversation({
        ownerId:req.userId,
        feature:source.feature,
        title:source.title+' \u2014 branch',
        metadata:{
          ...(source.metadata||{}),
          branched_from_conversation_id:source.id,
          branched_through_sequence:throughSequence
        }
      });

      for (const message of selected) {
        await store.appendMessage({
          conversationId:conversation.id,
          ownerId:req.userId,
          role:message.role,
          messageType:message.message_type,
          plainText:message.plain_text,
          content:message.content,
          metadata:{
            ...(message.metadata||{}),
            branched_from_message_id:message.id
          },
          provider:message.provider,
          model:message.model,
          requestId:
            'branch:'+source.id+':'+message.id
        });
      }

      return res.status(201).json({
        status:'success',
        conversation,
        copiedMessages:selected.length
      });
    } catch (error) {
      return sendConversationError(res,error,'branch');
    }
  });

  router.patch('/:conversationId', async (req, res) => {
    if (!isConversationId(req.params.conversationId)) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_conversation_id',
        message: 'Invalid conversation id.'
      });
    }

    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body
        : {};

    if (
      body.title !== undefined &&
      typeof body.title !== 'string'
    ) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_conversation_title',
        message: 'title must be a string.'
      });
    }

    if (
      body.pinned !== undefined &&
      typeof body.pinned !== 'boolean'
    ) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_conversation_pinned',
        message: 'pinned must be a boolean.'
      });
    }

    if (
      body.archived !== undefined &&
      typeof body.archived !== 'boolean'
    ) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_conversation_archived',
        message: 'archived must be a boolean.'
      });
    }

    try {
      const conversation = await store.updateConversation({
        conversationId: req.params.conversationId,
        ownerId: req.userId,
        title: body.title,
        pinned: body.pinned,
        archived: body.archived
      });

      return res.json({
        status: 'success',
        conversation
      });
    } catch (error) {
      return sendConversationError(
        res,
        error,
        'update'
      );
    }
  });

  router.get('/:conversationId/messages', async (req, res) => {
    if (!isConversationId(req.params.conversationId)) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_conversation_id',
        message: 'Invalid conversation id.'
      });
    }

    try {
      const messages = await store.listMessages({
        conversationId: req.params.conversationId,
        ownerId: req.userId,
        beforeSequence: req.query.beforeSequence,
        limit: req.query.limit
      });

      return res.json({
        status: 'success',
        messages,
        hasMore:
          messages.length ===
          conversationMemory.clampListLimit(req.query.limit)
      });
    } catch (error) {
      return sendConversationError(
        res,
        error,
        'messages'
      );
    }
  });

  return router;
}

module.exports = {
  createConversationRouter,
  isConversationId
};
