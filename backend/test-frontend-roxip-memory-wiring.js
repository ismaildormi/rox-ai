'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const frontend = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'index.html'),
  'utf8'
);

const normalizedFrontend = frontend.replaceAll(
  '\r\n',
  '\n'
);

const asyncMarker =
  'async function sendRoxIpDemo(text, msgBox) {';

const synchronousMarker =
  'function sendRoxIpDemo(text, msgBox) {';

const sections = normalizedFrontend.split(asyncMarker);

assert.strictEqual(
  sections.length - 1,
  2,
  'Both frontend copies must contain an async Rox IP demo flow.'
);

const flows = sections
  .slice(1)
  .map(section =>
    section.split('function sendMessage(feature){')[0]
  );

assert.strictEqual(
  flows.length,
  2,
  'Both Rox IP frontend flows must be extractable.'
);

flows.forEach((flow, index) => {
  const label = `Rox IP flow copy ${index + 1}`;

  assert(
    flow.includes(
      "await ensureRoxConversation('roxip', text)"
    ),
    `${label} must create or reuse a durable conversation.`
  );

  assert(
    flow.includes(
      'const turnId = createRoxTurnId();'
    ),
    `${label} must create a stable turn id.`
  );

  assert(
    flow.includes(
      "await authFetch(\n      '/api/roxip/demo-turn'"
    ),
    `${label} must call the authenticated Rox IP route.`
  );

  assert(
    flow.includes('conversationId,') &&
      flow.includes('turnId,') &&
      flow.includes('command: text,') &&
      flow.includes('responseText: finalMessage'),
    `${label} must send the complete durable payload.`
  );

  assert(
    flow.includes('if (isRoxDemoSession())'),
    `${label} must avoid database writes in demo sessions.`
  );

  assert(
    flow.includes(
      "data.code === 'conversation_message_limit'"
    ) &&
      flow.includes(
        "resetActiveRoxConversation('roxip');"
      ),
    `${label} must handle the 1000-message limit.`
  );

  assert(
    flow.includes('data.demoOnly !== true') &&
      flow.includes(
        'data.deviceActionExecuted !== false'
      ),
    `${label} must fail closed on the demo-only contract.`
  );

  assert(
    flow.includes(
      "appendMsg(msgBox, 'status', finalMessage);"
    ),
    `${label} must preserve the localized demo response.`
  );
});

const exactSynchronousStarts = normalizedFrontend
  .split('\n')
  .filter(line =>
    line.trim() === synchronousMarker
  );

const exactAsyncStarts = normalizedFrontend
  .split('\n')
  .filter(line =>
    line.trim() === asyncMarker
  );

assert.strictEqual(
  exactSynchronousStarts.length,
  0,
  'No exact synchronous Rox IP sender may remain.'
);

assert.strictEqual(
  exactAsyncStarts.length,
  2,
  'Exactly two async Rox IP senders must remain.'
);

console.log(
  'PASS: Rox IP frontend durable demo memory wiring tests'
);