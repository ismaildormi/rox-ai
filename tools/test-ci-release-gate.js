'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'ci-release-gate.yml'),
  'utf8'
);

function has(text) {
  assert.ok(workflow.includes(text), `missing CI contract: ${text}`);
}

for (const required of [
  'name: ZUVYR Release Quality Gate',
  'push:',
  'pull_request:',
  '- main',
  'permissions:',
  'contents: read',
  'concurrency:',
  'cancel-in-progress: true',
  'release-quality:',
  'backend-quality:',
  "node-version: '22'",
  'cache-dependency-path: package-lock.json',
  'cache-dependency-path: backend/package-lock.json',
  'run: npm ci',
  'run: node tools/test-release-validator-scope.js',
  'run: npm run validate:release',
  'run: node tools/test-ci-release-gate.js',
  'run: npm run test:unit',
  'run: npm run test:maintenance',
  'run: node test-readiness-gates.js',
  'run: node test-readiness-lifecycle.js',
]) {
  has(required);
}

assert.strictEqual(
  (workflow.match(/uses:\s*actions\/checkout@v4/g) || []).length,
  2,
  'both jobs must checkout the exact commit'
);

assert.ok(
  !/\bsecrets\./.test(workflow),
  'quality gate must not require repository secrets'
);

assert.ok(
  !/\b(railway|vercel)\s+(up|deploy|redeploy)\b/i.test(workflow) &&
  !/production-deploy\.sh/.test(workflow),
  'quality gate must validate only; it must not deploy'
);

console.log('PASS: ZUVYR CI release quality gate contract verified.');
