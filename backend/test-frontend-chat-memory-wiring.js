'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const frontend = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'index.html'),
  'utf8'
);

const senders = [
  ...frontend.matchAll(
    /async function sendChat\(feature, text, msgBox\) \{([\s\S]*?)\r?\nasync function sendGeneration\(feature, text, msgBox\) \{/g
  )
].map(match => match[1]);

assert.strictEqual(
  senders.length,
  2,
  'Both frontend copies must contain a Chat/Code sender.'
);

senders.forEach((sender, index) => {
  const label = `Chat/Code sender copy ${index + 1}`;

  assert(
    sender.includes('await ensureRoxConversation(feature, text);'),
    `${label} must create or reuse a durable conversation.`
  );

  assert(
    sender.includes('const turnId = createRoxTurnId();'),
    `${label} must create a stable turn id.`
  );

  assert(
    sender.includes('conversationId,') &&
      sender.includes('turnId,'),
    `${label} must send both durable references to /api/chat.`
  );

  assert(
    sender.includes("data.code === 'conversation_message_limit'"),
    `${label} must handle the 1000-message ceiling.`
  );

  assert(
    sender.includes('resetActiveRoxConversation(feature);'),
    `${label} must reset the full conversation before retry.`
  );

  assert(
    sender.includes("pushHistory(feature, 'user', text);") &&
      sender.includes("pushHistory(feature, 'assistant', data.text);"),
    `${label} must preserve existing local history compatibility.`
  );
});

console.log(
  'PASS: Chat and Code frontend durable memory wiring tests'
);