'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname,'..');
const read = relative => fs.readFileSync(path.join(root,relative),'utf8');
const js = read('frontend/zuvyr-chat-workspace-v1.js');
const css = read('frontend/zuvyr-chat-workspace-v1.css');
const html = read('frontend/index.html');

const count = (text,needle) => text.split(needle).length - 1;

[
  'const MAX_ATTACHMENTS_PER_TURN = 20;',
  'const MAX_ATTACHMENT_BYTES = 600 * 1024 * 1024;',
  'picker.multiple = true;',
  '/assets/upload-url',
  '.uploadToSignedUrl(',
  'new window.tus.Upload(',
  "headers:{'x-signature':entry.uploadToken}",
  'chunkSize:TUS_CHUNK_BYTES',
  'storage.supabase.co/storage/v1/upload/resumable',
  '/assets/complete',
  'waitForReadyAssets',
  'window.__zuvyrChatAttachmentIds',
  'window.__zuvyrSendingAttachmentEntries',
  'zuvyr-sent-attachments-message',
  'source.url?\'a\':\'div\''
].forEach(marker => assert.ok(js.includes(marker),`Missing JS marker: ${marker}`));

assert.strictEqual(count(html,'attachmentIds:'),2);
assert.strictEqual(count(html,'window.__zuvyrChatImageAttachment'),0);
assert.strictEqual(count(html,'Analyze the attached files.'),2);
assert.strictEqual(count(html,'zuvyr-chat-workspace-v1.css?v=28'),2);
assert.strictEqual(count(html,'zuvyr-chat-workspace-v1.js?v=28'),2);
assert.strictEqual(count(html,'tus-js-client@4.3.1/dist/tus.min.js'),2);
assert.strictEqual(count(html,'window.__zuvyrAttachmentUploadActive'),2);
assert.strictEqual(count(css,'/* ZUVYR DURABLE MULTI-ATTACHMENTS V1 */'),1);
assert.ok(css.includes('.zuvyr-attachment-list'));
assert.ok(css.includes('.zuvyr-sent-attachment-files'));

console.log('PASS: durable frontend multi-attachment upload and Sources wiring tests');