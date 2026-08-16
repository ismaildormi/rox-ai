'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const frontendPath = path.join(
  __dirname,
  '..',
  'frontend',
  'index.html'
);

const frontend = fs.readFileSync(frontendPath, 'utf8');

function countLiteral(text, literal) {
  assert.ok(literal, 'countLiteral requires a literal.');
  return text.split(literal).length - 1;
}

function extractFlows(text) {
  const startMarker =
    "async function loadRoxHistory(search=''){";

  const endMarker =
    'document.querySelectorAll(\'[data-open="history"]\').forEach(el=>{';

  const flows = [];
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
      'Each Search flow must have an exact History-open boundary.'
    );

    flows.push(text.slice(start, end));
    offset = end + endMarker.length;
  }

  return flows;
}

const flows = extractFlows(frontend);

assert.strictEqual(
  flows.length,
  2,
  'Mobile and desktop must each contain one Search-enabled History flow.'
);

flows.forEach((flow, index) => {
  const label = `History Search flow ${index + 1}`;

  assert.strictEqual(
    countLiteral(
      flow,
      "async function loadRoxHistory(search=''){"
    ),
    1,
    `${label} must accept one search argument.`
  );

  assert.strictEqual(
    countLiteral(flow, "String(search||'')"),
    1,
    `${label} must normalize its search value.`
  );

  const exactSearchNormalization = [
    "    const normalizedSearch=String(search||'')",
    '      .trim()',
    '      .slice(0,80);'
  ].join('\n');

  assert.strictEqual(
    countLiteral(flow, exactSearchNormalization),
    1,
    `${label} must contain one exact Search normalization block.`
  );


  assert.strictEqual(
    countLiteral(flow, "'&search='+encodeURIComponent(normalizedSearch)"),
    1,
    `${label} must safely encode the search query.`
  );

  assert.strictEqual(
    countLiteral(flow, '      query,'),
    1,
    `${label} must send the constructed query.`
  );

  assert.strictEqual(
    countLiteral(
      flow,
      "      '/api/conversations?limit=100&archived=false',"
    ),
    0,
    `${label} must not retain the old fixed request argument.`
  );

  assert.strictEqual(
    countLiteral(flow, 'function setupRoxHistorySearch(){'),
    1,
    `${label} must contain one Search setup function.`
  );

  assert.strictEqual(
    countLiteral(
      flow,
      "function setupRoxHistorySearch(){\n"+
      "  document.querySelectorAll(\n"+
      "    '[data-rox-history-search]'"
    ),
    1,
    `${label} must bind one scoped Search input selector.`
  );

  assert.strictEqual(
    countLiteral(
      flow,
      "input.dataset.roxHistorySearchReady==='true'"
    ),
    1,
    `${label} must prevent duplicate listener binding.`
  );

  assert.strictEqual(
    countLiteral(flow, "input.addEventListener('input',()=>{"),
    1,
    `${label} must react to Search input.`
  );

  assert.strictEqual(
    countLiteral(flow, 'loadRoxHistory(input.value);'),
    1,
    `${label} must reload History using the entered search.`
  );

  assert.strictEqual(
    countLiteral(flow, '},250);'),
    1,
    `${label} must debounce Search requests.`
  );

  assert.strictEqual(
    countLiteral(flow, 'setupRoxHistorySearch();'),
    1,
    `${label} must activate Search once.`
  );
});

assert.strictEqual(
  countLiteral(
    frontend,
    'class="rox-history-search-bar"'
  ),
  2,
  'Mobile and desktop must each render one History Search bar.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    'type="search"\n        data-rox-history-search\n        data-i18n-placeholder="common.search"'
  ),
  2,
  'Mobile and desktop must each render one exact History Search input.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    "function setupRoxHistorySearch(){\n  document.querySelectorAll(\n    '[data-rox-history-search]'"
  ),
  2,
  'Mobile and desktop must each contain one scoped Search setup selector.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    'data-i18n-placeholder="common.search"'
  ),
  2,
  'Both Search inputs must use the existing localized placeholder.'
);

const searchInputLimitPattern = [
  '        data-rox-history-search',
  '        data-i18n-placeholder="common.search"',
  '        placeholder="Search..."',
  '        maxlength="80"',
  '        autocomplete="off"'
].join('\n');

assert.strictEqual(
  countLiteral(
    frontend,
    searchInputLimitPattern
  ),
  2,
  'Both History Search inputs must match the backend search limit.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    '  .rox-history-search-bar{'
  ),
  2,
  'Both frontend copies must contain the base Search style.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    '  .rox-history-search-bar input{'
  ),
  2,
  'Both frontend copies must style the Search input.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    '  .rox-history-search-bar input::placeholder{'
  ),
  2,
  'Both frontend copies must style the Search placeholder.'
);

assert.strictEqual(
  countLiteral(frontend, '&search='),
  2,
  'Each scoped flow must construct one backend search parameter.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    "async function loadRoxHistory(){"
  ),
  0,
  'No legacy loadRoxHistory signature may remain.'
);

console.log(
  'PASS: five-service frontend durable History Search wiring tests'
);