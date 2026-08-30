'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  MAX_ATTACHMENT_CONTEXT_CHARS,
  MAX_RETRIEVED_ATTACHMENT_CHUNKS,
  attachmentQueryFromMessages,
  buildConversationAttachmentContext
} = require('./lib/conversationAttachmentContext');

const CONVERSATION_ID =
  '11111111-1111-4111-8111-111111111111';
const CHUNKED_ID =
  '66666666-6666-4666-8666-666666666666';

async function run() {
  assert.strictEqual(
    attachmentQueryFromMessages([
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Find the launch budget.' },
          { type: 'image_url', image_url: { url: 'data:test' } }
        ]
      }
    ]),
    'Find the launch budget.'
  );

  const calls = [];
  const store = {
    async listAssets() {
      return [
        {
          id: CHUNKED_ID,
          conversation_id: CONVERSATION_ID,
          asset_type: 'file',
          mime_type: 'text/plain',
          original_name: 'large-plan.txt',
          file_size_bytes: 150 * 1024 * 1024,
          scan_status: 'clean',
          extraction_status: 'ready',
          metadata: {
            extracted_text: 'IRRELEVANT PREVIEW MUST NOT WIN.',
            chunked: true,
            chunk_count: 10
          }
        }
      ];
    },
    async searchAssetChunks(input) {
      calls.push(input);
      return [
        {
          asset_id: CHUNKED_ID,
          chunk_index: 7,
          char_start: 329000,
          char_end: 377000,
          content: 'The verified launch budget is 25000 credits.',
          rank: 0.92
        }
      ];
    }
  };

  const context = await buildConversationAttachmentContext({
    conversationId: CONVERSATION_ID,
    ownerId: 'owner-1',
    attachmentIds: [CHUNKED_ID],
    query: 'What is the launch budget?',
    store,
    storage: { from() { throw new Error('download_not_expected'); } }
  });

  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], {
    assetIds: [CHUNKED_ID],
    ownerId: 'owner-1',
    query: 'What is the launch budget?',
    limit: MAX_RETRIEVED_ATTACHMENT_CHUNKS
  });
  assert.ok(
    context.systemContext.includes(
      'The verified launch budget is 25000 credits.'
    )
  );
  assert.ok(context.systemContext.includes('CHUNK 8'));
  assert.ok(!context.systemContext.includes('IRRELEVANT PREVIEW'));
  assert.ok(
    context.systemContext.length <
      MAX_ATTACHMENT_CONTEXT_CHARS + 2000
  );
  assert.strictEqual(context.sources.length, 1);
  assert.strictEqual(context.parts.length, 0);

  const server = fs.readFileSync(
    path.join(__dirname, 'server.js'),
    'utf8'
  );
  [
    'attachmentQueryFromMessages',
    'query: attachmentQueryFromMessages(messages)'
  ].forEach(marker => {
    assert.ok(
      server.includes(marker),
      'Missing retrieval routing marker: ' + marker
    );
  });

  console.log(
    'PASS: question-aware attachment chunk retrieval unit tests'
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
