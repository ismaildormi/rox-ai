'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(
  require.resolve('./lib/conversationRoutes'),
  'utf8'
);

[
  'const MAX_SYNC_ATTACHMENT_BYTES =',
  "typeof bucket.info === 'function'",
  'storedSize > MAX_SYNC_ATTACHMENT_BYTES',
  "scanStatus: 'pending'",
  "extractionStatus: 'pending'",
  "getAttachmentQueue().add(",
  "processing_mode: 'queued'",
  "status: 'queued'",
  'updateAssetProcessing({'
].forEach(marker => {
  assert.ok(
    source.includes(marker),
    'Missing large attachment route marker: ' + marker
  );
});

const infoAt = source.indexOf(
  "typeof bucket.info === 'function'"
);
const queueAt = source.indexOf(
  'storedSize > MAX_SYNC_ATTACHMENT_BYTES'
);
const downloadAt = source.indexOf(
  'bucket.download(uploadPath)'
);

assert.ok(infoAt >= 0 && infoAt < queueAt);
assert.ok(queueAt >= 0 && queueAt < downloadAt);

console.log(
  'PASS: large attachment completion queue route wiring tests'
);
