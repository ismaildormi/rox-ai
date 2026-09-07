'use strict';
const assert = require('node:assert/strict');
const { buildSafePreview } = require('./lib/codePreviewPolicy');
const { buildCodeArchiveManifest } = require('./lib/codeArchiveManifest');

const input = {
  name: 'Preview', entryFile: 'index.html',
  files: [
    { path: 'z.js', content: 'console.log(1)' },
    { path: 'index.html', content: '<!doctype html><html><head><title>x</title></head><body>ok</body></html>' }
  ]
};
const preview = buildSafePreview(input);
assert.equal(preview.sandbox, 'allow-scripts');
assert.equal(preview.networkEnabled, false);
assert(preview.srcdoc.includes('Content-Security-Policy'));
assert(preview.srcdoc.includes("connect-src 'none'"));
assert(!preview.sandbox.includes('allow-same-origin'));
const manifest = buildCodeArchiveManifest(input);
assert.deepEqual(manifest.files.map(file => file.path), ['index.html', 'z.js']);
assert.equal(manifest.fileCount, 2);
assert.equal(Object.hasOwn(manifest.files[0], 'content'), false);
console.log('PASS: Pack 06 CSP preview and deterministic ZIP manifest contract');
