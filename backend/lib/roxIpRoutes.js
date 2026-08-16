'use strict';

const express = require('express');
const {
  isConversationId
} = require('./conversationRoutes');
const {
  MAX_ROXIP_COMMAND_CHARS,
  MAX_ROXIP_RESPONSE_CHARS,
  recordRoxIpDemoTurn
} = require('./conversationRoxIp');

function sendValidationError(res, code, message) {
  return res.status(400).json({
    status: 'error',
    code,
    message
  });
}

function sendRoxIpError(res, error) {
  const code = String(
    error && (error.code || error.message) || ''
  );

  if (code === 'conversation_not_found') {
    return res.status(404).json({
      status: 'error',
      code,
      message: 'Conversation not found.'
    });
  }

  if (code === 'conversation_feature_mismatch') {
    return res.status(409).json({
      status: 'error',
      code,
      message:
        'This conversation belongs to another Rox service.'
    });
  }

  if (code === 'conversation_message_limit') {
    return res.status(409).json({
      status: 'error',
      code,
      message:
        'This conversation reached 1000 messages. Start a new chat.'
    });
  }

  if (
    code.startsWith('roxip_command_') ||
    code.startsWith('roxip_response_') ||
    code.startsWith('roxip_request_key_')
  ) {
    return res.status(400).json({
      status: 'error',
      code,
      message: 'Invalid Rox IP demo request.'
    });
  }

  console.error(
    '[roxip-api] demo memory save failed:',
    error && error.message ? error.message : error
  );

  return res.status(500).json({
    status: 'error',
    code: 'roxip_memory_save_failed',
    message: 'Rox IP demo history could not be saved.'
  });
}

function createRoxIpRouter({
  recordTurn = recordRoxIpDemoTurn
} = {}) {
  const router = express.Router();

  router.post('/demo-turn', async (req, res) => {
    const body =
      req.body &&
      typeof req.body === 'object' &&
      !Array.isArray(req.body)
        ? req.body
        : {};

    if (!isConversationId(body.conversationId)) {
      return sendValidationError(
        res,
        'invalid_conversation_id',
        'Invalid conversation id.'
      );
    }

    if (!isConversationId(body.turnId)) {
      return sendValidationError(
        res,
        'invalid_turn_id',
        'Invalid turn id.'
      );
    }

    if (
      typeof body.command !== 'string' ||
      !body.command.trim()
    ) {
      return sendValidationError(
        res,
        'invalid_roxip_command',
        'command must be a non-empty string.'
      );
    }

    if (body.command.length > MAX_ROXIP_COMMAND_CHARS) {
      return sendValidationError(
        res,
        'roxip_command_too_long',
        `command exceeds ${MAX_ROXIP_COMMAND_CHARS} characters.`
      );
    }

    if (
      typeof body.responseText !== 'string' ||
      !body.responseText.trim()
    ) {
      return sendValidationError(
        res,
        'invalid_roxip_response',
        'responseText must be a non-empty string.'
      );
    }

    if (
      body.responseText.length >
      MAX_ROXIP_RESPONSE_CHARS
    ) {
      return sendValidationError(
        res,
        'roxip_response_too_long',
        `responseText exceeds ${MAX_ROXIP_RESPONSE_CHARS} characters.`
      );
    }

    try {
      const result = await recordTurn({
        conversationId: body.conversationId,
        ownerId: req.userId,
        command: body.command,
        responseText: body.responseText,
        requestKey: body.turnId
      });

      return res.json({
        status: 'success',
        conversationId: body.conversationId,
        userMessageId: result.userMessage.id,
        assistantMessageId: result.assistantMessage.id,
        demoOnly: true,
        deviceActionExecuted: false
      });
    } catch (error) {
      return sendRoxIpError(res, error);
    }
  });

  return router;
}

module.exports = {
  createRoxIpRouter,
  sendRoxIpError
};