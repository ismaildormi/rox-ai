'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const server =
  fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const validation =
  fs.readFileSync(path.join(root, 'lib/inputValidation.js'), 'utf8');
const router =
  fs.readFileSync(path.join(root, 'aiRouter.js'), 'utf8');
const providers =
  fs.readFileSync(
    path.join(root, 'src/modules/ai/providers/index.js'),
    'utf8'
  );

for (const marker of [
  'attachmentIds = []',
  'attachmentIds: durableAttachmentIds',
  'buildConversationAttachmentContext',
  'applyAttachmentParts',
  'ATTACHMENT_ANALYSIS_RESERVATION_CREDITS',
  'attachmentAnalysisSettlement',
  'attachmentSources',
  'attachmentAnalysisRequestId'
]) {
  assert.ok(
    server.includes(marker),
    `Missing server multimodal marker: ${marker}`
  );
}

for (const marker of [
  'validateAttachmentIds',
  'attachmentIds require conversationId',
  'body.attachment && ids.length'
]) {
  assert.ok(
    validation.includes(marker),
    `Missing validation marker: ${marker}`
  );
}

for (const marker of [
  'OPENROUTER_MULTIMODAL_MODEL',
  "'input_audio'",
  "'video_url'",
  "'file'",
  'result.usage?.cost'
]) {
  assert.ok(
    router.includes(marker),
    `Missing router multimodal marker: ${marker}`
  );
}

assert.ok(
  providers.includes("'file-parser'"),
  'OpenRouter PDF file parser wiring is missing.'
);

console.log(
  'PASS: multimodal chat routing and credit wiring tests'
);