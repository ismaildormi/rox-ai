'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const frontend = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'index.html'),
  'utf8'
).replaceAll('\r\n', '\n');

function countLiteral(text, needle) {
  let count = 0;
  let position = 0;

  while (true) {
    const found = text.indexOf(needle, position);

    if (found < 0) return count;

    count += 1;
    position = found + needle.length;
  }
}

assert.strictEqual(
  countLiteral(frontend, '/api/history'),
  0,
  'The legacy snapshot history API must be removed.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    "'/api/conversations?limit=100&archived='+"
  ),
  2,
  'Both frontend copies must construct a durable History route.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    "(archived?'true':'false')+"
  ),
  2,
  'Both frontend copies must select Active or Archived conversations.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    "const response=await authFetch(\n      query,"
  ),
  2,
  'Both frontend copies must send the constructed durable History query.'
);

assert.strictEqual(
  countLiteral(frontend, "'/messages?limit=100'"),
  2,
  'Both frontend copies must load durable messages.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    'async function loadAllRoxConversationMessages'
  ),
  2,
  'Both copies must implement message pagination.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    'async function openRoxHistoryItem(item, row=null)'
  ),
  2,
  'Both copies must open durable history items.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    'setActiveRoxConversation(feature,item.id)'
  ),
  2,
  'Opening history must restore its active conversation id.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    "messageType==='roxip_event'"
  ),
  2,
  'Both copies must render Rox IP demo events.'
);

assert.strictEqual(
  countLiteral(frontend, 'content.url'),
  2,
  'Both copies must render stored image and video URLs.'
);

const marker =
  'async function loadAllRoxConversationMessages';

const sections = frontend.split(marker);

assert.strictEqual(
  sections.length - 1,
  2,
  'Exactly two durable history implementations must exist.'
);

const flows = sections
  .slice(1)
  .map(section =>
    section.split(
      'document.querySelectorAll(\'[data-open="history"]\').forEach'
    )[0]
  );

flows.forEach((flow, index) => {
  const label = `History flow copy ${index + 1}`;

  assert(
    flow.includes('while(pageCount<10 && messages.length<1000)') &&
      flow.includes('messages.unshift(...page)') &&
      flow.includes('return messages.slice(-1000);'),
    `${label} must paginate safely up to 1000 messages.`
  );

  assert(
    flow.includes('message.message_type') &&
      flow.includes('message.plain_text') &&
      flow.includes('content.text') &&
      flow.includes('content.url'),
    `${label} must consume the durable message contract.`
  );

  assert(
    flow.includes("messageType==='image'") &&
      flow.includes("messageType==='video'") &&
      flow.includes("messageType==='code'") &&
      flow.includes("messageType==='status'") &&
      flow.includes("messageType==='roxip_event'"),
    `${label} must support all current message types.`
  );

  assert(
    flow.includes("feature==='chat'") ||
      flow.includes("'💬'"),
    `${label} must support Chat history.`
  );

  assert(
    flow.includes("feature==='code'?'⌨️'") &&
      flow.includes("feature==='images'?'🖼️'") &&
      flow.includes("feature==='videos'?'🎬'") &&
      flow.includes("feature==='roxip'?'🖥️'"),
    `${label} must identify all five Rox services.`
  );

  assert(
    flow.includes('if(isRoxDemoSession())'),
    `${label} must avoid unavailable durable reads in demo mode.`
  );

  assert(
    flow.includes(
      "target.querySelectorAll('[data-rox-conversation-id]')"
    ) ||
      flow.includes(
        ".querySelectorAll('[data-rox-conversation-id]')"
      ),
    `${label} must bind durable conversation rows.`
  );
});

console.log(
  'PASS: five-service frontend durable history wiring tests'
);