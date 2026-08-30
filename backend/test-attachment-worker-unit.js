'use strict';

const assert = require('assert');
const {
  createAttachmentJobProcessor
} = require('./lib/attachmentWorker');

async function run() {
  const updates = [];
  const body = Buffer.alloc(4096);
  body.write('ID3', 0, 'ascii');

  const store = {
    async updateAssetProcessing(input) {
      updates.push(input);
      return {
        id: input.assetId,
        ...input
      };
    }
  };

  const storage = {
    from(name) {
      assert.strictEqual(
        name,
        'conversation-files'
      );

      return {
        async createSignedUrl(storagePath, seconds) {
          assert.ok(storagePath.endsWith('song.mp3'));
          assert.strictEqual(seconds, 7200);
          return {
            data: {
              signedUrl:
                'https://private.example/song'
            },
            error: null
          };
        }
      };
    }
  };

  const fetchImpl = async (_url, options) => {
    assert.ok(options.signal);
    return new Response(body, {
      status: 200
    });
  };

  const processJob =
    createAttachmentJobProcessor({
      store,
      storage,
      fetchImpl,
      maxBufferedBytes: 1024,
      analyzeWithProvider: async input => {
        assert.ok(require('fs').existsSync(input.filePath));
        assert.strictEqual(input.fileName, 'song.mp3');
        assert.strictEqual(input.mimeType, 'audio/mpeg');
        return {
          status: 'ready',
          mode: 'gemini_audio',
          text: 'Audio transcript.',
          provider: 'google-gemini',
          model: 'gemini-test-model',
          usage: { total_tokens: 12 },
          providerFileDeletion: () => ({
            attempted: true,
            succeeded: true
          })
        };
      }
    });

  const result = await processJob({
    data: {
      assetId: 'asset-1',
      conversationId:
        '22222222-2222-4222-8222-222222222222',
      ownerId:
        '11111111-1111-4111-8111-111111111111',
      storageBucket: 'conversation-files',
      storagePath:
        '11111111-1111-4111-8111-111111111111/' +
        '22222222-2222-4222-8222-222222222222/' +
        'upload-song.mp3',
      fileName: 'song.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: body.length,
      creditRequestId: 'attachment:test',
      ingestCredits: 1
    }
  });

  assert.strictEqual(
    updates[0].scanStatus,
    'scanning'
  );
  assert.strictEqual(
    updates[0].extractionStatus,
    'processing'
  );
  assert.strictEqual(
    updates[1].scanStatus,
    'clean'
  );
  assert.strictEqual(
    updates[1].extractionStatus,
     'ready'
  );
  assert.strictEqual(updates[1].sha256.length, 64);
  assert.strictEqual(
    updates[1].metadata.processing_mode,
    'queued'
  );
  assert.strictEqual(
    updates[1].metadata.extraction_mode,
    'gemini_audio'
  );
  assert.strictEqual(result.status, 'ready');
  assert.strictEqual(
    updates[1].metadata.extraction_provider,
    'google-gemini'
  );
  assert.strictEqual(
    updates[1].metadata.extraction_model,
    'gemini-test-model'
  );
  assert.deepStrictEqual(
    updates[1].metadata.provider_file_deletion,
    { attempted: true, succeeded: true }
  );

  const workerSource =
    require('fs').readFileSync(
      require.resolve('./worker'),
      'utf8'
    );

  [
    'const attachmentWorker = new Worker(',
    "'zuvyr-attachment-processing'",
    'ATTACHMENT_WORKER_CONCURRENCY',
    'processAttachmentJob',
    'handleAttachmentFailure',
    "attachmentWorker.on('failed'"
  ].forEach(marker => {
    assert.ok(
      workerSource.includes(marker),
      'Missing worker marker: ' + marker
    );
  });

  console.log(
    'PASS: streaming large attachment worker unit tests'
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
