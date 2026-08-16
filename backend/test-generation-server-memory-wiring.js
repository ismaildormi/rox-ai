'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const server = fs.readFileSync(
    path.join(__dirname, 'server.js'),
    'utf8'
  );

  assert(
    server.includes(
      "prepareGenerationConversation,"
    )
  );

  assert(
    server.includes(
      "failGenerationConversation"
    )
  );

  const inspection = server.indexOf(
    'memoryConversation = await inspectConversationTurn',
    server.indexOf('async function handleGenerationRequest')
  );

  const reservation = server.indexOf(
    'reservation = await reserveCredits',
    server.indexOf('async function handleGenerationRequest')
  );

  const promptSave = server.indexOf(
    'requestMessage = await prepareGenerationConversation'
  );

  const jobInsert = server.indexOf(
    "conversation_id: conversationId || null"
  );

  const queueAdd = server.indexOf(
    "await queue.add('generate'"
  );

  assert(inspection >= 0);
  assert(reservation >= 0);
  assert(promptSave >= 0);
  assert(jobInsert >= 0);
  assert(queueAdd >= 0);

  assert(inspection < reservation);
  assert(reservation < promptSave);
  assert(promptSave < jobInsert);
  assert(jobInsert < queueAdd);

  assert(
    server.includes(
      'request_message_id:'
    )
  );

  assert(
    server.includes(
      'memoryRequestKey'
    )
  );

  assert(
    server.includes(
      'conversationId: conversationId || undefined'
    )
  );

  const failureCalls =
    server.match(
      /await failGenerationConversation/g
    ) || [];

  assert.strictEqual(
    failureCalls.length,
    2
  );

  console.log(
    'PASS: image and video server memory wiring tests'
  );
}

run();
