'use strict';

const assert = require('node:assert/strict');
const {
  config,
  assertVideoOperationAvailable,
  assertVideoRequestAvailable,
  providerSupports,
  inventory
} = require('./lib/videoOperationRegistry');

assert.equal(config.version, 'pack-05.video-system.v1');
for (const operation of [
  'text_to_video', 'image_to_video', 'edit', 'extend',
  'subtitles', 'enhance', 'export'
]) {
  assert.throws(
    () => assertVideoOperationAvailable(operation),
    error => error.code === 'video_operation_unpriced' && error.operation === operation
  );
  assert.throws(
    () => assertVideoRequestAvailable({ operation }),
    error => error.code === 'video_operation_unpriced'
  );
}
assert.throws(
  () => assertVideoOperationAvailable('not-real'),
  error => error.code === 'unknown_video_operation'
);
assert.equal(providerSupports('replicate', 'text_to_video'), true);
assert.equal(providerSupports('replicate', 'image_to_video'), false);
assert.equal(providerSupports('unknown', 'text_to_video'), false);
assert.deepEqual(Object.keys(inventory().operations), Object.keys(config.operations));
assert.equal(inventory().jobs.cancelEnabledByDefault, false);

console.log('PASS: Pack 05 video registry and every unpriced operation fail closed');
