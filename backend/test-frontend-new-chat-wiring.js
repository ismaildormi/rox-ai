'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const frontend = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'index.html'),
  'utf8'
);

function countLiteral(text, needle) {
  let count = 0;
  let offset = 0;

  while (true) {
    const found = text.indexOf(needle, offset);

    if (found === -1) {
      return count;
    }

    count += 1;
    offset = found + needle.length;
  }
}

const functionMarker =
  'function setupRoxNewChatButtons() {';
const callMarker =
  'setupRoxNewChatButtons();';

const flows = frontend
  .split(functionMarker)
  .slice(1)
  .map(section => section.split(callMarker)[0]);

assert.strictEqual(
  flows.length,
  2,
  'Both frontend copies must contain New Chat setup.'
);

assert.strictEqual(
  countLiteral(frontend, callMarker),
  2,
  'Both frontend copies must initialize New Chat.'
);

assert.strictEqual(
  countLiteral(frontend, 'data-rox-new-chat'),
  2,
  'Both frontend copies must query New Chat buttons.'
);

function countExactSelector(selector) {
  return frontend
    .split(/\r?\n/)
    .filter(line => line.trim() === selector)
    .length;
}

assert.strictEqual(
  countExactSelector('.rox-new-chat{'),
  2,
  'Both CSS copies must contain the base New Chat style.'
);

assert.strictEqual(
  countExactSelector(
    '.modal-backdrop .modal-topbar .rox-new-chat{'
  ),
  2,
  'Both CSS copies must position the desktop New Chat button.'
);

assert.strictEqual(
  countExactSelector(
    '.feature-topbar .rox-new-chat{'
  ),
  2,
  'Both CSS copies must contain the mobile New Chat rule.'
);

const features = [
  'chat',
  'code',
  'images',
  'videos',
  'roxip'
];

flows.forEach((flow, index) => {
  const label = `New Chat flow copy ${index + 1}`;

  features.forEach(feature => {
    assert(
      flow.includes(`#feature-${feature}`),
      `${label} must include ${feature}.`
    );

    assert(
      flow.includes(
        `${feature}: 'features.${feature}.prompt'`
      ),
      `${label} must restore the ${feature} prompt.`
    );
  });

  assert(
    flow.includes(
      "button.dataset.roxNewChat = feature;"
    ),
    `${label} must identify the feature button.`
  );

  assert(
    flow.includes(
      "label.dataset.i18n = 'features.chat.new';"
    ),
    `${label} must translate the button label.`
  );

  assert(
    flow.includes(
      "button.setAttribute(" +
      "\n        'aria-label',"
    ),
    `${label} must provide an accessible label.`
  );

  assert(
    flow.includes(
      "resetActiveRoxConversation(feature);"
    ),
    `${label} must reset the active conversation.`
  );

  assert(
    flow.includes(
      "msgBox.replaceChildren(prompt);"
    ),
    `${label} must restore the initial prompt.`
  );

  assert(
    flow.includes("input.value = '';"),
    `${label} must clear the feature input.`
  );

  assert(
    flow.includes('input.focus();'),
    `${label} must return focus to the input.`
  );

  assert(
    !flow.includes('authFetch('),
    `${label} must not delete or mutate saved history.`
  );
});

assert.strictEqual(
  countLiteral(
    frontend,
    'resetActiveRoxConversation(feature);'
  ),
  6,
  'Four limit handlers plus two New Chat resets are required.'
);

assert.strictEqual(
  countLiteral(
    frontend,
    'msgBox.replaceChildren(prompt);'
  ),
  2,
  'Both copies must reset their visible transcript.'
);

console.log(
  'PASS: five-service frontend New Chat wiring tests'
);