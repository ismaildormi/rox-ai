'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  DEFAULT_TEXT_CHUNK_CHARS,
  isChunkableTextFile,
  streamTextChunks
} = require('./lib/attachmentChunking');
const {
  createAttachmentJobProcessor
} = require('./lib/attachmentWorker');

async function run() {
  assert.strictEqual(
    isChunkableTextFile({
      fileName: 'large.csv',
      mimeType: 'text/csv',
      head: Buffer.from('name,value\nalpha,1\n')
    }),
    true
  );
  assert.strictEqual(
    isChunkableTextFile({
      fileName: 'fake.txt',
      mimeType: 'text/plain',
      head: Buffer.from([0, 1, 2, 3, 4])
    }),
    false
  );

  const tempDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'zuvyr-chunk-test-')
  );
  const tempFile = path.join(tempDir, 'large.txt');
  const line = 'alpha beta gamma delta epsilon\n';
  const payload = Buffer.from(line.repeat(9000), 'utf8');
  await fsp.writeFile(tempFile, payload);

  try {
    const chunks = [];
    for await (const chunk of streamTextChunks({
      filePath: tempFile
    })) {
      chunks.push(chunk);
    }

    assert.ok(chunks.length > 1);
    assert.ok(
      chunks.every(item => (
        item.content.length > 0 &&
        item.content.length <= DEFAULT_TEXT_CHUNK_CHARS
      ))
    );
    assert.deepStrictEqual(
      chunks.map(item => item.chunkIndex),
      chunks.map((_item, index) => index)
    );

    const updates = [];
    const indexed = [];
    const store = {
      async updateAssetProcessing(value) {
        updates.push(value);
        return { id: value.assetId, metadata: value.metadata };
      },
      async replaceAssetChunks({ chunks: source }) {
        for await (const chunk of source) indexed.push(chunk);
        return { chunkCount: indexed.length };
      }
    };
    const storage = {
      from() {
        return {
          async createSignedUrl() {
            return {
              data: { signedUrl: 'https://private.test/file' },
              error: null
            };
          }
        };
      }
    };
    const processor = createAttachmentJobProcessor({
      store,
      storage,
      tempRoot: tempDir,
      maxBufferedBytes: 64,
      fetchImpl: async () => new Response(payload)
    });
    const result = await processor({
      data: {
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        ownerId: 'owner-1',
        storageBucket: 'conversation-files',
        storagePath: 'owner-1/conversation-1/file.txt',
        creditRequestId: 'credit-1',
        fileName: 'large.txt',
        mimeType: 'text/plain',
        sizeBytes: payload.length,
        ingestCredits: 1
      }
    });

    assert.strictEqual(result.status, 'ready');
    assert.ok(indexed.length > 1);
    const finalUpdate = updates[updates.length - 1];
    assert.strictEqual(finalUpdate.extractionStatus, 'ready');
    assert.strictEqual(finalUpdate.metadata.chunked, true);
    assert.strictEqual(
      finalUpdate.metadata.chunk_count,
      indexed.length
    );

    const migration = fs.readFileSync(
      path.join(__dirname, '20_conversation_file_storage.sql'),
      'utf8'
    );
    const memory = fs.readFileSync(
      path.join(__dirname, 'lib', 'conversationMemory.js'),
      'utf8'
    );
    [
      'create table if not exists public.conversation_asset_chunks',
      'idx_conversation_asset_chunks_search',
      'search_conversation_asset_chunks'
    ].forEach(marker => assert.ok(migration.includes(marker), marker));
    assert.ok(
      migration.includes(
        'references public.shared_conversations(id)'
      ),
      'Chunk conversation FK must target shared_conversations.'
    );
    assert.ok(
      !migration.includes(
        'references public.conversations(id)'
      ),
      'Invalid conversations table reference must not return.'
    );
    [
      'async function replaceAssetChunks',
      'async function searchAssetChunks',
      "from('conversation_asset_chunks')"
    ].forEach(marker => assert.ok(memory.includes(marker), marker));

    console.log(
      'PASS: streaming large text chunking and durable index unit tests'
    );
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
