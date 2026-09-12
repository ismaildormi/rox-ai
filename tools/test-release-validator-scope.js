'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const validator = fs.readFileSync(path.join(__dirname, 'validate-release.js'), 'utf8');

for (const required of [
  'function isHistoricalSourceSnapshot(file)',
  "file.endsWith('.js') && !isHistoricalSourceSnapshot(file)",
  '/\\.before-[^/\\\\]*\\.js$/i.test(base)',
  '/\\.backup-before-[^/\\\\]*\\.js$/i.test(base)',
  '/\\.bak\\.js$/i.test(base)',
]) {
  assert.ok(validator.includes(required), `validator scope marker missing: ${required}`);
}

for (const active of [
  'backend/lib/codeArchiveManifest.js',
  'backend/test-frontend-history-archive-wiring.js',
  'backend/test-pack06-preview-archive.js',
]) {
  assert.ok(fs.existsSync(path.join(root, active)), `expected active archive-named source: ${active}`);
}

assert.ok(
  !validator.includes("includes('archive')") &&
  !validator.includes('includes("archive")'),
  'validator must not broadly exclude files merely because their names contain archive'
);

console.log('PASS: release validator scope excludes only explicit historical JS snapshots.');
