'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, 'lib', 'conversationMemory.js'),
  'utf8'
);

[
  'async function updateAssetProcessing({',
  ".eq('id', normalizedAssetId)",
  ".eq('owner_id', normalizedOwnerId)",
  "'conversation_asset_update_empty'",
  "'conversation_asset_update_failed'",
  'updateAssetProcessing: (...args) =>',
  ".order('created_at', { ascending: false })"
].forEach(marker => {
  assert.ok(
    source.includes(marker),
    `Missing durable asset update marker: ${marker}`
  );
});

assert.ok(
  source.includes("'pending'") &&
  source.includes("'scanning'") &&
  source.includes("'clean'") &&
  source.includes("'rejected'") &&
  source.includes("'failed'"),
  'Asset scan lifecycle must remain explicit.'
);

console.log(
  'PASS: durable conversation asset processing update wiring tests'
);