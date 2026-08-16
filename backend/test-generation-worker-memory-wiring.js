'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const worker = fs.readFileSync(
  path.join(__dirname, 'worker.js'),
  'utf8'
);

function count(pattern) {
  return (worker.match(pattern) || []).length;
}

assert.strictEqual(
  count(/require\('\.\/lib\/conversationGeneration'\)/g),
  1,
  'Worker must import conversation generation helpers once.'
);

assert.strictEqual(
  count(/completeGenerationConversation/g),
  3,
  'Worker must import and call completion for image and video.'
);

assert.strictEqual(
  count(/failGenerationConversation/g),
  2,
  'Worker must import and call final failure persistence.'
);

assert.strictEqual(
  count(/response_message_id:/g),
  3,
  'Image, video and failure paths must link response messages.'
);

assert.strictEqual(
  count(/memoryRequestKey \|\| requestId \|\| jobRowId/g),
  3,
  'All terminal paths must use stable idempotency keys.'
);

assert(
  worker.includes("feature: 'image'"),
  'Image completion must use the image feature.'
);

assert(
  worker.includes("feature: 'video'"),
  'Video completion must use the video feature.'
);

assert(
  worker.includes("provider: 'replicate'") &&
    worker.includes('model: VIDEO_MODEL'),
  'Video completion must persist provider and model.'
);

assert(
  worker.indexOf('if (attemptsMade < maxAttempts)') <
    worker.indexOf(
      'failureMessage = await failGenerationConversation'
    ),
  'Failure memory must only be saved after retries are exhausted.'
);

assert(
  worker.indexOf(
    'failureMessage = await failGenerationConversation'
  ) < worker.indexOf('await refundCredits(requestId)'),
  'Failure memory must preserve the existing refund flow.'
);

assert(
  worker.includes(
    '[worker-memory] image completion save failed:'
  ) &&
    worker.includes(
      '[worker-memory] video completion save failed:'
    ),
  'Memory outages must be logged without failing generation.'
);

console.log(
  'PASS: image and video worker memory wiring tests'
);