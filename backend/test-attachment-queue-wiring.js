'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, 'lib', 'queue.js'),
  'utf8'
);

assert.strictEqual(
  (source.match(/new Queue\('rox-image-generation'/g) || []).length,
  1
);
assert.strictEqual(
  (source.match(/new Queue\('rox-video-generation'/g) || []).length,
  1
);
assert.strictEqual(
  (source.match(/new Queue\('zuvyr-attachment-processing'/g) || []).length,
  1
);
assert.ok(
  source.includes(
    'imageQueue, videoQueue, attachmentQueue, defaultJobOptions'
  ),
  'The attachment queue must be exported without replacing existing queues.'
);

console.log(
  'PASS: isolated durable attachment queue wiring tests'
);