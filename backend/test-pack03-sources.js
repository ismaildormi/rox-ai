'use strict';

const assert = require('node:assert/strict');
const { safeHttpsUrl, normalizeSources, attachmentSources } = require('./lib/sourceContract');

assert.equal(safeHttpsUrl('https://example.com/page#section'), 'https://example.com/page');
assert.throws(() => safeHttpsUrl('http://example.com'), error => error.code === 'invalid_source_url_protocol');
assert.throws(() => safeHttpsUrl('javascript:alert(1)'), error => error.code === 'invalid_source_url_protocol');

const web = normalizeSources([
  { type: 'web', title: 'Example', url: 'https://example.com/a', snippet: ' one  two ' },
  { type: 'web', title: 'Duplicate', url: 'https://example.com/a#x' },
  { type: 'web', title: 'Second', url: 'https://example.org/b' }
]);
assert.equal(web.length, 2);
assert.deepEqual(web.map(item => item.citationId), ['source-1', 'source-2']);
assert.equal(web[0].snippet, 'one two');

const files = attachmentSources([{ id: 'asset-1', name: 'plan.pdf', mimeType: 'application/pdf', assetType: 'file', extractionStatus: 'ready' }]);
assert.equal(files[0].type, 'file');
assert.equal(files[0].externalId, 'asset-1');
assert.equal(files[0].url, null);
assert.equal(files[0].metadata.extractionStatus, 'ready');

console.log('PASS: Pack 03 normalized, deduplicated and HTTPS-only source contract');
