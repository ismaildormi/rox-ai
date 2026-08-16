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
      "inspectConversationTurn,"
    )
  );

  assert(
    server.includes(
      "prepareConversationTurn,"
    )
  );

  assert(
    server.includes(
      "completeConversationTurn"
    )
  );

  assert(
    server.includes(
      "const memoryRequestKey = turnId || requestId;"
    )
  );

  assert(
    server.includes(
      "This conversation reached 1000 messages. Start a new chat."
    )
  );

  const inspectionPosition = server.indexOf(
    'memoryConversation = await inspectConversationTurn'
  );

  const codeChargePosition = server.indexOf(
    'reservation = await reserveCredits'
  );

  const dailyChargePosition = server.indexOf(
    'dailyStatus = await checkAndIncrementDailyChat'
  );

  assert(inspectionPosition >= 0);
  assert(codeChargePosition >= 0);
  assert(dailyChargePosition >= 0);
  assert(inspectionPosition < codeChargePosition);
  assert(inspectionPosition < dailyChargePosition);

  const preparePosition = server.indexOf(
    'const preparedTurn = await prepareConversationTurn'
  );

  const routePosition = server.indexOf(
    'const result = await routeRequest'
  );

  const completePosition = server.indexOf(
    'const assistantMessage = await completeConversationTurn'
  );

  assert(preparePosition >= 0);
  assert(routePosition >= 0);
  assert(completePosition >= 0);
  assert(preparePosition < routePosition);
  assert(routePosition < completePosition);

  assert(
    server.includes(
      'if (!memoryConversation) {'
    )
  );

  assert(
    server.includes(
      'conversationId: conversationId || undefined'
    )
  );

  assert(
    server.includes(
      'conversationMessageCount:'
    )
  );

  console.log(
    'PASS: chat and code durable memory wiring tests'
  );
}

run();
