'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const frontend = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'index.html'),
  'utf8'
);

const generationMarker =
  'async function sendGeneration(feature, text, msgBox) {';

const roxIpMarker =
  'function sendRoxIpDemo(text, msgBox) {';

const generationParts =
  frontend.split(generationMarker);

assert.strictEqual(
  generationParts.length,
  3,
  'Both frontend copies must contain a generation flow.'
);

const flows = generationParts
  .slice(1)
  .map((part, index) => {
    const endIndex = part.indexOf(roxIpMarker);

    assert(
      endIndex >= 0,
      `Generation flow copy ${index + 1} must end before Rox IP.`
    );

    return part.slice(0, endIndex);
  });

assert.strictEqual(
  flows.length,
  2,
  'Exactly two generation flows must be extracted.'
);

flows.forEach((flow, index) => {
  const label = `Generation flow copy ${index + 1}`;

  assert(
    flow.includes('await ensureRoxConversation(feature, text);'),
    `${label} must create or reuse a durable conversation.`
  );

  assert(
    flow.includes('const turnId = createRoxTurnId();'),
    `${label} must create a stable turn id.`
  );

  assert(
    flow.includes('prompt: text,') &&
      flow.includes('conversationId,') &&
      flow.includes('turnId,'),
    `${label} must send prompt and durable references.`
  );

  assert(
    flow.includes("data.code === 'conversation_message_limit'") &&
      flow.includes('resetActiveRoxConversation(feature);'),
    `${label} must handle the 1000-message ceiling.`
  );

  assert(
    flow.includes('await pollJob(data.jobId, feature, msgBox, typing);'),
    `${label} must preserve job polling.`
  );

  assert(
    flow.includes("if (data.status === 'done')") &&
      flow.includes('img.src = data.result_url;') &&
      flow.includes('vid.src = data.result_url;'),
    `${label} must preserve image and video result rendering.`
  );

  assert(
    flow.includes("if (data.status === 'failed')"),
    `${label} must preserve generation failure handling.`
  );
});

console.log(
  'PASS: Image and Video frontend durable memory wiring tests'
);