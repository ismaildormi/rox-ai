'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const apiPath = path.join(root, 'Dockerfile');
const workerPath = path.join(root, 'Dockerfile.worker');
const api = fs.readFileSync(apiPath, 'utf8');
const worker = fs.readFileSync(workerPath, 'utf8');

[
  'FROM node:22-alpine AS deps',
  'FROM node:22-alpine AS runtime',
  'RUN npm install --omit=dev --no-audit --no-fund',
  'libreoffice-common',
  'libreoffice-writer',
  'libreoffice-calc',
  'libreoffice-impress',
  'poppler-utils',
  'tesseract-ocr',
  'tesseract-ocr-data-eng',
  'tesseract-ocr-data-ara',
  'tesseract-ocr-data-fra',
  'font-noto-arabic',
  'ATTACHMENT_DOCUMENT_TOOLS_ENABLED=1',
  'ATTACHMENT_OCR_LANGUAGES=eng+ara+fra',
  'HOME=/tmp/zuvyr-worker-home',
  'USER node',
  'ENTRYPOINT ["/sbin/tini", "--"]',
  'CMD ["node", "worker.js"]'
].forEach(marker => {
  assert.ok(
    worker.includes(marker),
    'Missing document worker marker: ' + marker
  );
});

assert.ok(
  !worker.includes('CMD ["node", "server.js"]'),
  'Worker image must never start the public API server.'
);
assert.ok(
  api.includes('RUN apk add --no-cache tini') &&
  api.includes('CMD ["node", "server.js"]'),
  'The public API Dockerfile must remain on its minimal server path.'
);
[
  'libreoffice-common',
  'poppler-utils',
  'tesseract-ocr'
].forEach(marker => {
  assert.ok(
    !api.includes(marker),
    'Public API image must not contain worker document tool: ' + marker
  );
});

console.log(
  'PASS: isolated document worker image wiring tests'
);