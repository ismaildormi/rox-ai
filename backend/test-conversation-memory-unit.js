'use strict';

const assert = require('assert');

const {
  MAX_CONVERSATION_MESSAGES,
  normalizeFeature,
  normalizeTitle,
  normalizeRole,
  normalizeMessageType,
  clampListLimit,
  buildRollingSummary,
  buildProviderMessages
} = require('./lib/conversationMemory');

function run() {
  assert.strictEqual(MAX_CONVERSATION_MESSAGES, 1000);

  assert.strictEqual(normalizeFeature('chat'), 'chat');
  assert.strictEqual(normalizeFeature('code'), 'code');
  assert.strictEqual(normalizeFeature('image'), 'images');
  assert.strictEqual(normalizeFeature('images'), 'images');
  assert.strictEqual(normalizeFeature('video'), 'videos');
  assert.strictEqual(normalizeFeature('videos'), 'videos');
  assert.strictEqual(normalizeFeature('roxip'), 'roxip');
  assert.strictEqual(normalizeFeature('unknown'), 'chat');

  assert.strictEqual(
    normalizeTitle('   Moroccan   coffee   website   '),
    'Moroccan coffee website'
  );

  assert.strictEqual(
    normalizeTitle('', 'New Rox chat'),
    'New Rox chat'
  );

  assert.strictEqual(normalizeRole('USER'), 'user');
  assert.throws(
    () => normalizeRole('owner'),
    /invalid_conversation_role/
  );

  assert.strictEqual(normalizeMessageType('IMAGE'), 'image');
  assert.throws(
    () => normalizeMessageType('unknown'),
    /invalid_conversation_message_type/
  );

  assert.strictEqual(clampListLimit(undefined), 50);
  assert.strictEqual(clampListLimit(0), 1);
  assert.strictEqual(clampListLimit(500), 100);

  const summary = buildRollingSummary(
    'Earlier decision',
    [
      { role: 'user', plain_text: 'Keep the blue Rox identity.' },
      { role: 'assistant', plain_text: 'Confirmed.' }
    ],
    10000
  );

  assert(summary.includes('Earlier decision'));
  assert(summary.includes('User: Keep the blue Rox identity.'));
  assert(summary.includes('Rox: Confirmed.'));

  const limitedSummary = buildRollingSummary(
    '',
    [{ role: 'user', plain_text: 'x'.repeat(200) }],
    80
  );

  assert.strictEqual(limitedSummary.length, 80);

  const providerMessages = buildProviderMessages({
    summary: 'The project name is Rox.',
    messages: [
      { role: 'user', plain_text: 'First question' },
      { role: 'assistant', plain_text: 'First answer' },
      { role: 'status', plain_text: 'Ignored status' },
      { role: 'user', plain_text: 'Latest question' }
    ],
    maxMessages: 3,
    maxCharacters: 1000
  });

  assert.strictEqual(providerMessages[0].role, 'system');
  assert(providerMessages[0].content.includes('Rox'));
  assert.strictEqual(providerMessages[1].role, 'user');
  assert.strictEqual(providerMessages[2].role, 'assistant');
  assert.strictEqual(providerMessages[3].role, 'user');

  const merged = buildProviderMessages({
    messages: [
      { role: 'user', plain_text: 'Part one' },
      { role: 'user', plain_text: 'Part two' },
      { role: 'assistant', plain_text: 'Answer' }
    ]
  });

  assert.strictEqual(merged.length, 2);
  assert(merged[0].content.includes('Part one'));
  assert(merged[0].content.includes('Part two'));

  const bounded = buildProviderMessages({
    messages: [
      { role: 'user', plain_text: 'a'.repeat(100) },
      { role: 'assistant', plain_text: 'b'.repeat(100) },
      { role: 'user', plain_text: 'latest' }
    ],
    maxMessages: 2,
    maxCharacters: 150
  });

  assert(bounded.length <= 2);
  assert.strictEqual(
    bounded[bounded.length - 1].content,
    'latest'
  );

  const fs = require('fs');
  const path = require('path');

  const migration = fs.readFileSync(
    path.join(__dirname, '18_unified_conversation_memory.sql'),
    'utf8'
  );

  assert(
    migration.includes(
      'create unique index if not exists idx_conversation_messages_request_id'
    )
  );

  assert(
    migration.includes(
      'on conversation_messages(conversation_id, request_id)'
    )
  );

  assert(
    migration.includes(
      'where request_id is not null;'
    )
  );

  const retryLookupPosition = migration.indexOf(
    'if p_request_id is not null then'
  );

  const limitGuardPosition = migration.indexOf(
    'if current_count >= 1000 then'
  );

  assert(retryLookupPosition >= 0);
  assert(limitGuardPosition >= 0);
  assert(retryLookupPosition < limitGuardPosition);

  assert(
    migration.includes(
      'create unique index if not exists idx_conversation_assets_message_type'
    )
  );

  assert(
    migration.includes(
      'on conversation_assets(conversation_id, message_id, asset_type)'
    )
  );

  const memorySource = fs.readFileSync(
    path.join(__dirname, 'lib', 'conversationMemory.js'),
    'utf8'
  );

  assert(
    memorySource.includes(
      "assetWrite = assetWrite.upsert("
    )
  );

  assert(
    memorySource.includes(
      "'conversation_id,message_id,asset_type'"
    )
  );

  console.log('PASS: unified conversation memory unit tests');
}

run();