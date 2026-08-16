'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const frontend = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'index.html'),
  'utf8'
);

const routes = fs.readFileSync(
  path.join(__dirname, 'lib', 'conversationRoutes.js'),
  'utf8'
);

function countLiteral(text, literal) {
  assert.ok(literal, 'countLiteral requires a literal.');
  return text.split(literal).length - 1;
}

function extractSegments(text, startMarker, endMarker) {
  const segments = [];
  let offset = 0;

  while (true) {
    const start = text.indexOf(startMarker, offset);

    if (start < 0) {
      break;
    }

    const end = text.indexOf(endMarker, start);

    assert.notStrictEqual(
      end,
      -1,
      `Missing boundary after ${startMarker}`
    );

    segments.push(text.slice(start, end));
    offset = end + endMarker.length;
  }

  return segments;
}

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
  'Mobile and desktop must each contain one exact Rename binding flow.'
);

const renameHandlerStart =
  "      const renameButton=row.querySelector(";

const renameHandlerEnd =
  "      row.addEventListener('click',()=>{";

bindings.forEach((binding, index) => {
  const label = `Rename binding ${index + 1}`;

  const renameHandlers = extractSegments(
    binding,
    renameHandlerStart,
    renameHandlerEnd
  );

  assert.strictEqual(
    renameHandlers.length,
    1,
    `${label} must contain one exact Rename handler.`
  );

  const renameHandler = renameHandlers[0];

  const expectedOnce = [
    "row.querySelector(\n        '[data-rox-history-rename]'",
    "renameButton.addEventListener(\n          'click'",
    'event.preventDefault();',
    'event.stopPropagation();',
    "window.prompt(\n              roxT('history.renamePrompt')",
    "const nextTitle=String(entered).trim();",
    "'/api/conversations/'+",
    'encodeURIComponent(id)',
    "method:'PATCH'",
    "'Content-Type':'application/json'",
    'body:JSON.stringify({',
    'title:nextTitle',
    "data.status!=='success'",
    '!data.conversation',
    'item.title=String(',
    "row.querySelector('.t')",
    "roxT('history.renameFailed')",
    'renameButton.disabled=true;',
    'renameButton.disabled=false;'
  ];

  expectedOnce.forEach(literal => {
    assert.strictEqual(
      countLiteral(renameHandler, literal),
      1,
      `${label} must contain exactly one ${literal}`
    );
  });
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
  'Mobile and desktop must each contain one exact Rename row flow.'
);

loadFlows.forEach((flow, index) => {
  const label = `Rename row ${index + 1}`;

  const expectedOnce = [
    'class="rox-history-actions"',
    'class="rox-history-rename"',
    'data-rox-history-rename',
    "escapeHtml(roxT('history.rename'))",
    '<div class="chev">›</div></div></div>'
  ];

  expectedOnce.forEach(literal => {
    const expected =
      literal === "escapeHtml(roxT('history.rename'))"
        ? 2
        : 1;

    assert.strictEqual(
      countLiteral(flow, literal),
      expected,
      `${label} has an invalid count for ${literal}`
    );
  });
});

[
  "'history.rename':",
  "'history.renamePrompt':",
  "'history.renameFailed':"
].forEach(key => {
  assert.strictEqual(
    countLiteral(frontend, `    ${key}`),
    10,
    `${key} must exist in five languages across both frontend copies.`
  );
});

[
  '  .rox-history-actions{',
  '  .rox-history-actions .chev{',
  '  .rox-history-rename{',
  '  .rox-history-rename:hover{',
  '  .rox-history-rename:active{',
  '  .rox-history-rename:disabled{'
].forEach(selector => {
  assert.strictEqual(
    countLiteral(frontend, selector),
    2,
    `${selector} must be styled in both frontend copies.`
  );
});

const patchStart =
  "  router.patch('/:conversationId', async (req, res) => {";

const patchEnd =
  "  router.get('/:conversationId/messages', async (req, res) => {";

const patchSegments = extractSegments(
  routes,
  patchStart,
  patchEnd
);

assert.strictEqual(
  patchSegments.length,
  1,
  'The authenticated conversation router must contain one PATCH flow.'
);

const patch = patchSegments[0];

[
  "typeof body.title !== 'string'",
  'title: body.title',
  'conversationId: req.params.conversationId',
  'ownerId: req.userId',
  "status: 'success'",
].forEach(literal => {
  assert.strictEqual(
    countLiteral(patch, literal),
    1,
    `PATCH contract must contain exactly one ${literal}`
  );
});

const exactUpdateBlock = [
  '      const conversation = await store.updateConversation({',
  '        conversationId: req.params.conversationId,',
  '        ownerId: req.userId,',
  '        title: body.title,',
  '        pinned: body.pinned,',
  '        archived: body.archived',
  '      });'
].join('\n');

const exactResponseBlock = [
  '      return res.json({',
  "        status: 'success',",
  '        conversation',
  '      });'
].join('\n');

assert.strictEqual(
  countLiteral(patch, exactUpdateBlock),
  1,
  'PATCH contract must contain one exact owned conversation update block.'
);

assert.strictEqual(
  countLiteral(patch, exactResponseBlock),
  1,
  'PATCH contract must contain one exact success response block.'
);

console.log(
  'PASS: five-service frontend durable History Rename wiring tests'
);