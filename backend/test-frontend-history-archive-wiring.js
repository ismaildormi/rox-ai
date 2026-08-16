'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readUtf8(relativePath) {
  const fullPath = path.join(
    __dirname,
    '..',
    relativePath
  );

  const bytes = fs.readFileSync(fullPath);

  assert.strictEqual(
    bytes.subarray(0, 3).equals(
      Buffer.from([0xef, 0xbb, 0xbf])
    ),
    false,
    `${relativePath} must remain UTF-8 without BOM.`
  );

  return bytes.toString('utf8');
}

function countLiteral(text, literal) {
  assert.ok(
    literal,
    'countLiteral requires a literal.'
  );

  return text.split(literal).length - 1;
}

function extractSegments(
  text,
  startMarker,
  endMarker
) {
  const segments = [];
  let offset = 0;

  while (true) {
    const start = text.indexOf(
      startMarker,
      offset
    );

    if (start < 0) {
      break;
    }

    const end = text.indexOf(
      endMarker,
      start
    );

    assert.notStrictEqual(
      end,
      -1,
      `Missing end marker after ${startMarker}`
    );

    segments.push(
      text.slice(start, end)
    );

    offset = end + endMarker.length;
  }

  return segments;
}

const frontend = readUtf8(
  'frontend/index.html'
);

const routes = readUtf8(
  'backend/lib/conversationRoutes.js'
);

const memory = readUtf8(
  'backend/lib/conversationMemory.js'
);

const migration = readUtf8(
  'backend/18_unified_conversation_memory.sql'
);

assert.strictEqual(
  countLiteral(
    frontend,
    'class="rox-history-view-tabs"'
  ),
  2,
  'Mobile and desktop must each render one History view tab container.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    'class="rox-history-view" ' +
    'data-rox-history-view="active" ' +
    'aria-selected="true"'
  ),
  2,
  'Mobile and desktop must each default to Active history.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    'class="rox-history-view" ' +
    'data-rox-history-view="archived" ' +
    'aria-selected="false"'
  ),
  2,
  'Mobile and desktop must each expose an Archived history tab.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    'data-i18n="history.active"'
  ),
  2,
  'Both Active tabs must use i18n.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    'data-i18n="history.archived"'
  ),
  2,
  'Both Archived tabs must use i18n.'
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

const archiveHandlerStart =
  "      const archiveButton=row.querySelector(";

const archiveHandlerEnd =
  "      const pinButton=row.querySelector(";

bindings.forEach((binding, index) => {
  const label =
    `Archive binding ${index + 1}`;

  const handlers = extractSegments(
    binding,
    archiveHandlerStart,
    archiveHandlerEnd
  );

  assert.strictEqual(
    handlers.length,
    1,
    `${label} must contain one scoped Archive handler.`
  );

  const handler = handlers[0];

  const expectedOnce = [
    "row.querySelector(\n" +
      "        '[data-rox-history-archive]'",
    "archiveButton.addEventListener(\n" +
      "          'click'",
    'event.preventDefault();',
    'event.stopPropagation();',
    'const nextArchived=!Boolean(item.archived);',
    "window.confirm(\n" +
      "                roxT('history.archiveConfirm')",
    'archiveButton.disabled=true;',
    "'/api/conversations/'+",
    'encodeURIComponent(id)',
    "method:'PATCH'",
    "'Content-Type':'application/json'",
    'body:JSON.stringify({',
    'archived:nextArchived',
    "data.status!=='success'",
    '!data.conversation',
    'item.archived=Boolean(',
    "target.closest(\n" +
      "                '.feature-screen, .modal-backdrop'",
    "historyRoot.querySelector(\n" +
      "                    '[data-rox-history-search]'",
    'await loadRoxHistory(',
    "roxT('history.archiveFailed')",
    'archiveButton.disabled=false;'
  ];

  expectedOnce.forEach(literal => {
    assert.strictEqual(
      countLiteral(handler, literal),
      1,
      `${label} must contain exactly one ${literal}`
    );
  });

  assert.strictEqual(
    countLiteral(
      handler,
      'pinned:nextPinned'
    ),
    0,
    `${label} must not contain the Pin payload.`
  );

  assert.strictEqual(
    countLiteral(
      handler,
      'title:nextTitle'
    ),
    0,
    `${label} must not contain the Rename payload.`
  );
});

const loadStart =
  "async function loadRoxHistory(search=''){";

const loadEnd =
  'function setupRoxHistoryViews(){';

const loadFlows = extractSegments(
  frontend,
  loadStart,
  loadEnd
);

assert.strictEqual(
  loadFlows.length,
  2,
  'Mobile and desktop must each contain one Archive-aware load flow.'
);

loadFlows.forEach((flow, index) => {
  const label =
    `Archive load flow ${index + 1}`;

  const expectedOnce = [
    'const archived=Boolean(',
    "'[data-rox-history-view=\"archived\"]'+",
    "'[aria-selected=\"true\"]'",
    "'/api/conversations?limit=100&archived='+",
    "(archived?'true':'false')+",
    "'&search='+encodeURIComponent(normalizedSearch)",
    'const archiveActionLabel=item.archived',
    "roxT('history.unarchive')",
    "roxT('history.archive')",
    'class="rox-history-archive"',
    'data-rox-history-archive',
    "(item.archived?'↩':'🗄️')"
  ];

  expectedOnce.forEach(literal => {
    assert.strictEqual(
      countLiteral(flow, literal),
      1,
      `${label} must contain exactly one ${literal}`
    );
  });

  assert.strictEqual(
    countLiteral(
      flow,
      'escapeHtml(archiveActionLabel)'
    ),
    2,
    `${label} must use the Archive label for title and aria-label.`
  );

  assert.strictEqual(
    countLiteral(
      flow,
      "'/api/conversations?limit=100&archived=false'+"
    ),
    0,
    `${label} must not retain the Active-only route.`
  );
});

const viewStart =
  'function setupRoxHistoryViews(){';

const viewEnd =
  'function setupRoxHistorySearch(){';

const viewFlows = extractSegments(
  frontend,
  viewStart,
  viewEnd
);

assert.strictEqual(
  viewFlows.length,
  2,
  'Mobile and desktop must each contain one scoped History view setup.'
);

viewFlows.forEach((flow, index) => {
  const label =
    `History view setup ${index + 1}`;

  const expectedOnce = [
    "button.dataset.roxHistoryViewReady==='true'",
    "button.addEventListener('click',()=>{",
    "button.dataset.roxHistoryView||'active'",
    "candidate.setAttribute(\n" +
      "          'aria-selected'",
    "candidate.dataset.roxHistoryView===\n" +
      "            nextView",
    "button.closest(\n" +
      "        '.feature-screen, .modal-backdrop'",
    "historyRoot.querySelector(\n" +
      "            '[data-rox-history-search]'",
    'loadRoxHistory('
  ];

  expectedOnce.forEach(literal => {
    assert.strictEqual(
      countLiteral(flow, literal),
      1,
      `${label} must contain exactly one ${literal}`
    );
  });

  assert.strictEqual(
    countLiteral(
      flow,
      "'[data-rox-history-view]'"
    ),
    2,
    `${label} must bind and synchronize the History view buttons.`
  );
});

assert.strictEqual(
  countLiteral(
    frontend,
    'setupRoxHistoryViews();'
  ),
  2,
  'Both frontend copies must activate History view tabs.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    'class="rox-history-archive"'
  ),
  2,
  'Both row renderers must expose one Archive action.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    'archived:nextArchived'
  ),
  2,
  'Both Archive handlers must send one archived boolean payload.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    '  .rox-history-view-tabs{'
  ),
  2,
  'Both CSS copies must style History tabs.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    '  .rox-history-view[aria-selected="true"]{'
  ),
  2,
  'Both CSS copies must style the selected History tab.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    '  .rox-history-archive,'
  ),
  2,
  'Both CSS copies must include the Archive action.'
);

[
  'history.active',
  'history.archived',
  'history.archive',
  'history.unarchive',
  'history.archiveConfirm',
  'history.archiveFailed'
].forEach(key => {
  assert.strictEqual(
    countLiteral(
      frontend,
      `'${key}':`
    ),
    10,
    `${key} must exist in five languages and two frontend copies.`
  );
});

assert.strictEqual(
  countLiteral(
    routes,
    "body.archived !== undefined &&\n" +
      "      typeof body.archived !== 'boolean'"
  ),
  1,
  'Backend PATCH must validate archived as a boolean.'
);

assert.strictEqual(
  countLiteral(
    routes,
    'archived: body.archived'
  ),
  1,
  'Backend PATCH must forward archived exactly once.'
);

assert.strictEqual(
  countLiteral(
    memory,
    ".eq('archived', Boolean(archived))"
  ),
  1,
  'Conversation listing must filter the requested archive state.'
);

assert.strictEqual(
  countLiteral(
    memory,
    'patch.archived = Boolean(archived);'
  ),
  1,
  'Conversation updates must persist archived state.'
);

assert.strictEqual(
  countLiteral(
    migration,
    'add column if not exists archived ' +
      'boolean not null default false'
  ),
  1,
  'Migration must define the durable archived column.'
);

console.log(
  'PASS: five-service frontend durable History Archive wiring tests'
);