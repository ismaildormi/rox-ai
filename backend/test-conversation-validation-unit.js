'use strict';

const assert = require('assert');
const {
  validateChatBody,
  validatePromptBody,
  validateConversationReferences
} = require('./lib/inputValidation');

const VALID_CONVERSATION_ID =
  '11111111-1111-4111-8111-111111111111';

const VALID_TURN_ID =
  '22222222-2222-4222-8222-222222222222';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function runMiddleware(middleware, body) {
  const req = { body };
  const res = createResponse();
  let nextCalls = 0;

  middleware(req, res, () => {
    nextCalls += 1;
  });

  return {
    res,
    nextCalls
  };
}

function run() {
  let res = createResponse();

  assert.strictEqual(
    validateConversationReferences({}, res),
    true
  );

  res = createResponse();

  assert.strictEqual(
    validateConversationReferences({
      conversationId: VALID_CONVERSATION_ID,
      turnId: VALID_TURN_ID
    }, res),
    true
  );

  let result = runMiddleware(
    validateChatBody,
    {
      feature: 'chat',
      conversationId: VALID_CONVERSATION_ID,
      turnId: VALID_TURN_ID,
      messages: [{
        role: 'user',
        content: 'Hello Rox'
      }]
    }
  );

  assert.strictEqual(result.nextCalls, 1);
  assert.strictEqual(result.res.statusCode, 200);

  result = runMiddleware(
    validateChatBody,
    {
      feature: 'chat',
      conversationId: 'invalid-id',
      messages: [{
        role: 'user',
        content: 'Hello Rox'
      }]
    }
  );

  assert.strictEqual(result.nextCalls, 0);
  assert.strictEqual(result.res.statusCode, 400);
  assert.match(
    result.res.body.message,
    /conversationId/
  );

  result = runMiddleware(
    validateChatBody,
    {
      feature: 'code',
      turnId: 'invalid-turn',
      messages: [{
        role: 'user',
        content: 'Build an app'
      }]
    }
  );

  assert.strictEqual(result.nextCalls, 0);
  assert.strictEqual(result.res.statusCode, 400);
  assert.match(
    result.res.body.message,
    /turnId/
  );

  result = runMiddleware(
    validatePromptBody,
    {
      prompt: 'A realistic Moroccan city',
      conversationId: VALID_CONVERSATION_ID,
      turnId: VALID_TURN_ID
    }
  );

  assert.strictEqual(result.nextCalls, 1);
  assert.strictEqual(result.res.statusCode, 200);

  result = runMiddleware(
    validatePromptBody,
    {
      prompt: 'A cinematic video',
      conversationId: 123
    }
  );

  assert.strictEqual(result.nextCalls, 0);
  assert.strictEqual(result.res.statusCode, 400);

  console.log(
    'PASS: conversation reference validation unit tests'
  );
}

run();
