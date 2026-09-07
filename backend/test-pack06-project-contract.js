'use strict';
const assert = require('node:assert/strict');
const { normalizeProjectPath, normalizeCodeProject } = require('./lib/codeProjectContract');

assert.equal(normalizeProjectPath('src\\app.js'), 'src/app.js');
const project = normalizeCodeProject({
  name: 'Safe app',
  entryFile: 'index.html',
  files: [
    { path: 'index.html', content: '<h1>ZUVYR</h1>', language: 'HTML' },
    { path: 'src/app.js', content: 'console.log("ok")' }
  ]
});
assert.equal(project.files.length, 2);
assert.equal(project.files[0].sha256.length, 64);
assert.equal(project.totalBytes, Buffer.byteLength('<h1>ZUVYR</h1>console.log("ok")'));
for (const badPath of ['../.env', '/etc/passwd', 'C:\\secrets.txt', '.env', 'src/%2e%2e/key', '.git/config', 'node_modules/x.js']) {
  assert.throws(() => normalizeProjectPath(badPath), error => String(error.code).startsWith('code_file_'));
}
assert.throws(() => normalizeCodeProject({ name: 'x', files: [{ path: 'A.js', content: '' }, { path: 'a.js', content: '' }] }), { code: 'duplicate_code_file_path' });
assert.throws(() => normalizeCodeProject({ name: 'x', entryFile: 'missing.html', files: [{ path: 'index.html', content: '' }] }), { code: 'code_project_entry_missing' });
console.log('PASS: Pack 06 bounded multi-file project and secret-path contract');
