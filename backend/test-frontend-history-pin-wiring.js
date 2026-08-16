'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const backendRoot = __dirname;
const projectRoot = path.join(backendRoot, '..');

function readUtf8(relativePath) {
  const filePath = path.join(projectRoot, relativePath);
  const bytes = fs.readFileSync(filePath);

  assert.notStrictEqual(
    bytes.subarray(0, 3).toString('hex'),
    'efbbbf',
    `${relativePath} must be UTF-8 without BOM.`
  );

  return bytes
    .toString('utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function countLiteral(text, literal) {
  assert.ok(literal, 'countLiteral requires a literal.');

  let count = 0;
  let offset = 0;

  while (true) {
    const index = text.indexOf(literal, offset);

    if (index === -1) {
      return count;
    }

    count += 1;
    offset = index + literal.length;
  }
}

function extractSegments(text, startMarker, endMarker) {
  const segments = [];
  let offset = 0;

  while (true) {
    const start = text.indexOf(startMarker, offset);

    if (start === -1) {
      break;
    }

    const end = text.indexOf(
      endMarker,
      start + startMarker.length
    );

    assert.notStrictEqual(
      end,
      -1,
      `Missing end marker after ${startMarker}`
    );

    segments.push(text.slice(start, end));
    offset = end + endMarker.length;
  }

  return segments;
}

const frontend = readUtf8('frontend/index.html');
const routes = readUtf8('backend/lib/conversationRoutes.js');
const memory = readUtf8('backend/lib/conversationMemory.js');
const migration = readUtf8(
  'backend/18_unified_conversation_memory.sql'
);

const bindingStart =
  'function bindRoxHistoryRows(target, items){';

const bindingEnd =
  "async function loadRoxHistory(search=''){";

const bindings = extractSegments(
  frontend,
  bindingStart,
  bindingEnd
);

assert.strictEqual(
  bindings.length,
  2,
  'Mobile and desktop must each contain one History binding flow.'
);

const pinHandlerStart =
  "      const pinButton=row.querySelector(";

const pinHandlerEnd =
  "      const renameButton=row.querySelector(";

bindings.forEach((binding, index) => {
  const label = `Pin binding ${index + 1}`;

  const pinHandlers = extractSegments(
    binding,
    pinHandlerStart,
    pinHandlerEnd
  );

  assert.strictEqual(
    pinHandlers.length,
    1,
    `${label} must contain one exact Pin handler.`
  );

  const pinHandler = pinHandlers[0];

  const expectedOnce = [
    "row.querySelector(\n        '[data-rox-history-pin]'",
    "pinButton.addEventListener(\n          'click'",
    'event.preventDefault();',
    'event.stopPropagation();',
    'const nextPinned=!Boolean(item.pinned);',
    'pinButton.disabled=true;',
    "'/api/conversations/'+",
    'encodeURIComponent(id)',
    "method:'PATCH'",
    "'Content-Type':'application/json'",
    'body:JSON.stringify({',
    'pinned:nextPinned',
    "data.status!=='success'",
    '!data.conversation',
    'item.pinned=Boolean(',
    "target.closest(\n                '.feature-screen, .modal-backdrop'",
    "historyRoot.querySelector(\n                    '[data-rox-history-search]'",
    'await loadRoxHistory(',
    "roxT('history.pinFailed')",
    'pinButton.disabled=false;'
  ];

  expectedOnce.forEach(literal => {
    assert.strictEqual(
      countLiteral(pinHandler, literal),
      1,
      `${label} must contain exactly one ${literal}`
    );
  });

  assert.strictEqual(
    countLiteral(pinHandler, 'title:nextTitle'),
    0,
    `${label} must not contain the Rename payload.`
  );
});

const loadStart =
  "async function loadRoxHistory(search=''){";

const loadEnd =
  'document.querySelectorAll(\'[data-open="history"]\').forEach(el=>{';

const loadFlows = extractSegments(
  frontend,
  loadStart,
  loadEnd
);

assert.strictEqual(
  loadFlows.length,
  2,
  'Mobile and desktop must each contain one History row flow.'
);

loadFlows.forEach((flow, index) => {
  const label = `Pin row ${index + 1}`;

  const expectedOnce = [
    "const pin=item.pinned?' · 📌':'';",
    'const pinActionLabel=item.pinned',
    "roxT('history.unpin')",
    "roxT('history.pin')",
    'class="rox-history-pin"',
    'data-rox-history-pin',
    'aria-pressed="',
    "(item.pinned?'true':'false')",
    '">📌</button>'
  ];

  expectedOnce.forEach(literal => {
    assert.strictEqual(
      countLiteral(flow, literal),
      1,
      `${label} must contain exactly one ${literal}`
    );
  });

  assert.strictEqual(
    countLiteral(flow, 'escapeHtml(pinActionLabel)'),
    2,
    `${label} must use the Pin label for title and aria-label.`
  );

  assert.strictEqual(
    countLiteral(flow, 'data-rox-history-rename'),
    1,
    `${label} must preserve the Rename button.`
  );
});

[
  "'history.pin':",
  "'history.unpin':",
  "'history.pinFailed':"
].forEach(key => {
  assert.strictEqual(
    countLiteral(frontend, key),
    10,
    `${key} must exist in five languages and two frontend copies.`
  );
});

assert.strictEqual(
  countLiteral(
    frontend,
    '.rox-history-pin,\n  .rox-history-rename{'
  ),
  2,
  'Both frontend CSS copies must style Pin and Rename together.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    '.rox-history-pin[aria-pressed="true"]{'
  ),
  2,
  'Both frontend CSS copies must style the active Pin state.'
);

assert.strictEqual(
  countLiteral(frontend, 'data-rox-history-pin'),
  4,
  'Frontend must contain two Pin buttons and two Pin hooks.'
);

assert.strictEqual(
  countLiteral(frontend, 'pinned:nextPinned'),
  2,
  'Frontend must contain one scoped Pin payload per copy.'
);

assert.strictEqual(
  countLiteral(
    routes,
    "body.pinned !== undefined &&\n      typeof body.pinned !== 'boolean'"
  ),
  1,
  'Backend PATCH must validate the pinned boolean.'
);

assert.strictEqual(
  countLiteral(routes, 'pinned: body.pinned'),
  1,
  'Backend PATCH must forward pinned exactly once.'
);

assert.strictEqual(
  countLiteral(
    memory,
    "if (pinned !== undefined) {\n      patch.pinned = Boolean(pinned);\n    }"
  ),
  1,
  'Conversation memory must update pinned explicitly.'
);

assert.strictEqual(
  countLiteral(
    memory,
    ".order('pinned', { ascending: false })"
  ),
  1,
  'Conversation history must list pinned conversations first.'
);

assert.strictEqual(
  countLiteral(
    migration,
    'add column if not exists pinned boolean not null default false'
  ),
  1,
  'The migration must define the durable pinned column.'
);

assert.strictEqual(
  countLiteral(frontend, 'data-rox-history-rename'),
  4,
  'Pin wiring must preserve both Rename buttons and hooks.'
);

console.log(
  'PASS: five-service frontend durable History Pin wiring tests'
);