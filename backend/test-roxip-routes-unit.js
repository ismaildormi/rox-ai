'use strict';

const assert = require('assert');
const express = require('express');
const {
  createRoxIpRouter
} = require('./lib/roxIpRoutes');

const CONVERSATION_ID =
  '11111111-1111-4111-8111-111111111111';
const TURN_ID =
  '22222222-2222-4222-8222-222222222222';
const OWNER_ID =
  '33333333-3333-4333-8333-333333333333';

function createError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function run() {
  const calls = [];
  let nextError = null;

  async function recordTurn(input) {
    calls.push(input);

    if (nextError) {
      const error = nextError;
      nextError = null;
      throw error;
    }

    return {
      userMessage: {
        id: 101
      },
      assistantMessage: {
        id: 102
      },
      demoOnly: true,
      deviceActionExecuted: false
    };
  }

  const app = express();

  app.use(express.json());

  app.use((req, res, next) => {
    req.userId = OWNER_ID;
    next();
  });

  app.use(
    '/api/roxip',
    createRoxIpRouter({
      recordTurn
    })
  );

  const server = await new Promise(resolve => {
    const instance = app.listen(
      0,
      () => resolve(instance)
    );
  });

  const address = server.address();
  const baseUrl =
    `http://127.0.0.1:${address.port}/api/roxip`;

  async function post(body) {
    const response = await fetch(
      `${baseUrl}/demo-turn`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );

    return {
      response,
      body: await response.json()
    };
  }

  const validBody = {
    conversationId: CONVERSATION_ID,
    turnId: TURN_ID,
    command: 'Open the browser',
    responseText:
      'Rox IP is in demo mode. No device action was performed.'
  };

  try {
    let result = await post(validBody);

    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.status, 'success');
    assert.strictEqual(
      result.body.conversationId,
      CONVERSATION_ID
    );
    assert.strictEqual(result.body.userMessageId, 101);
    assert.strictEqual(
      result.body.assistantMessageId,
      102
    );
    assert.strictEqual(result.body.demoOnly, true);
    assert.strictEqual(
      result.body.deviceActionExecuted,
      false
    );

    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(
      calls[0],
      {
        conversationId: CONVERSATION_ID,
        ownerId: OWNER_ID,
        command: validBody.command,
        responseText: validBody.responseText,
        requestKey: TURN_ID
      }
    );

    result = await post({
      ...validBody,
      conversationId: 'not-a-uuid'
    });

    assert.strictEqual(result.response.status, 400);
    assert.strictEqual(
      result.body.code,
      'invalid_conversation_id'
    );

    result = await post({
      ...validBody,
      turnId: 'not-a-uuid'
    });

    assert.strictEqual(result.response.status, 400);
    assert.strictEqual(
      result.body.code,
      'invalid_turn_id'
    );

    result = await post({
      ...validBody,
      command: ''
    });

    assert.strictEqual(result.response.status, 400);
    assert.strictEqual(
      result.body.code,
      'invalid_roxip_command'
    );

    result = await post({
      ...validBody,
      responseText: ''
    });

    assert.strictEqual(result.response.status, 400);
    assert.strictEqual(
      result.body.code,
      'invalid_roxip_response'
    );

    result = await post({
      ...validBody,
      command: 'x'.repeat(2001)
    });

    assert.strictEqual(result.response.status, 400);
    assert.strictEqual(
      result.body.code,
      'roxip_command_too_long'
    );

    result = await post({
      ...validBody,
      responseText: 'x'.repeat(8001)
    });

    assert.strictEqual(result.response.status, 400);
    assert.strictEqual(
      result.body.code,
      'roxip_response_too_long'
    );

    nextError = createError(
      'conversation_not_found'
    );

    result = await post(validBody);

    assert.strictEqual(result.response.status, 404);
    assert.strictEqual(
      result.body.code,
      'conversation_not_found'
    );

    nextError = createError(
      'conversation_feature_mismatch'
    );

    result = await post(validBody);

    assert.strictEqual(result.response.status, 409);
    assert.strictEqual(
      result.body.code,
      'conversation_feature_mismatch'
    );

    nextError = createError(
      'conversation_message_limit'
    );

    result = await post(validBody);

    assert.strictEqual(result.response.status, 409);
    assert.strictEqual(
      result.body.code,
      'conversation_message_limit'
    );

    const originalError = console.error;
    const logs = [];

    console.error = (...args) => {
      logs.push(args);
    };

    try {
      nextError = new Error('database_unavailable');
      result = await post(validBody);
    } finally {
      console.error = originalError;
    }

    assert.strictEqual(result.response.status, 500);
    assert.strictEqual(
      result.body.code,
      'roxip_memory_save_failed'
    );
    assert.strictEqual(logs.length, 1);

    console.log(
      'PASS: authenticated Rox IP demo routes unit tests'
    );
  } finally {
    await new Promise(resolve => {
      server.close(resolve);
    });
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});