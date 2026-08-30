'use strict';

const assert = require('assert');
const express = require('express');
const {
  createConversationRouter
} = require('./lib/conversationRoutes');

const CONVERSATION_ID =
  '11111111-1111-4111-8111-111111111111';

const OWNER_ID = 'owner-123';

async function run() {
  const storeCalls = [];
  const storageCalls = [];
  const creditCalls = [];

  const safeAudio = Buffer.alloc(4096);
  safeAudio.write('ID3', 0, 'ascii');

  const dangerousFile = Buffer.alloc(256);
  dangerousFile[0] = 0x4d;
  dangerousFile[1] = 0x5a;

  const store = {
    async requireOwnedConversation(
      conversationId,
      ownerId
    ) {
      storeCalls.push([
        'require',
        {
          conversationId,
          ownerId
        }
      ]);

      return {
        id: conversationId,
        owner_id: ownerId,
        feature: 'chat'
      };
    },

    async addAsset(input) {
      storeCalls.push(['addAsset', input]);

      return {
        id: 'asset-1',
        ...input
      };
    }
  };

  const bucket = {
    async download(storagePath) {
      storageCalls.push([
        'download',
        {
          storagePath
        }
      ]);

      const content =
        storagePath.endsWith(
          '-dangerous.pdf'
        )
          ? dangerousFile
          : safeAudio;

      return {
        data: new Blob([content]),
        error: null
      };
    },

    async remove(paths) {
      storageCalls.push([
        'remove',
        {
          paths
        }
      ]);

      return {
        data: paths,
        error: null
      };
    }
  };

  const storage = {
    from(bucketName) {
      storageCalls.push([
        'bucket',
        {
          bucketName
        }
      ]);

      return bucket;
    }
  };

  const creditManager = {
    async reserveCredits(input) {
      creditCalls.push([
        'reserve',
        input
      ]);

      return {
        newBalance: 99,
        replayed: false
      };
    },

    async refundCredits(requestId) {
      creditCalls.push([
        'refund',
        {
          requestId
        }
      ]);

      return {
        newBalance: 100
      };
    },

    async reportRefundFailure(input) {
      creditCalls.push([
        'refundFailure',
        input
      ]);
    }
  };

  const app = express();

  app.use(express.json());

  app.use((req, res, next) => {
    req.userId = OWNER_ID;
    next();
  });

  app.use(
    '/api/conversations',
    createConversationRouter({
      store,
      storage,
      creditManager
    })
  );

  const server = await new Promise(resolve => {
    const instance =
      app.listen(0, () => resolve(instance));
  });

  const baseUrl =
    `http://127.0.0.1:${server.address().port}` +
    '/api/conversations';

  try {
    const safePath =
      `${OWNER_ID}/${CONVERSATION_ID}/` +
      'upload-1-song.mp3';

    let response = await fetch(
      `${baseUrl}/${CONVERSATION_ID}` +
      '/assets/complete',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          path: safePath,
          fileName: 'song.mp3',
          mimeType: 'audio/mpeg',
          sizeBytes: safeAudio.length
        })
      }
    );

    assert.strictEqual(response.status, 201);

    let body = await response.json();

    assert.strictEqual(body.status, 'success');
    assert.strictEqual(
      body.asset.assetType,
      'audio'
    );
    assert.strictEqual(
      body.asset.scanStatus,
      'clean'
    );
    assert.strictEqual(
      body.asset.extractionStatus,
      'pending'
    );
    assert.strictEqual(
      body.asset.metadata.kind,
      'source'
    );
    assert.strictEqual(
      body.extraction.status,
      'provider_required'
    );
    assert.strictEqual(
      body.creditsCharged,
      1
    );
    assert.strictEqual(
      body.newBalance,
      99
    );

    const reserveCall =
      creditCalls.find(
        call => call[0] === 'reserve'
      );

    assert.strictEqual(
      reserveCall[1].creditsConsumed,
      1
    );
    assert.strictEqual(
      reserveCall[1].feature,
      'chat'
    );

    assert.strictEqual(
      creditCalls.filter(
        call => call[0] === 'refund'
      ).length,
      0
    );

    const addCall =
      storeCalls.find(
        call => call[0] === 'addAsset'
      );

    assert.strictEqual(
      addCall[1].storagePath,
      safePath
    );
    assert.strictEqual(
      addCall[1].sha256.length,
      64
    );

    response = await fetch(
      `${baseUrl}/${CONVERSATION_ID}` +
      '/assets/complete',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          path:
            `another-owner/${CONVERSATION_ID}/` +
            'upload-2-song.mp3',
          fileName: 'song.mp3',
          mimeType: 'audio/mpeg',
          sizeBytes: safeAudio.length
        })
      }
    );

    assert.strictEqual(response.status, 400);

    body = await response.json();

    assert.strictEqual(
      body.code,
      'invalid_attachment_path'
    );

    const dangerousPath =
      `${OWNER_ID}/${CONVERSATION_ID}/` +
      'upload-3-dangerous.pdf';

    response = await fetch(
      `${baseUrl}/${CONVERSATION_ID}` +
      '/assets/complete',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          path: dangerousPath,
          fileName: 'dangerous.pdf',
          mimeType: 'application/pdf',
          sizeBytes: dangerousFile.length
        })
      }
    );

    assert.strictEqual(response.status, 415);

    body = await response.json();

    assert.strictEqual(
      body.code,
      'dangerous_attachment_content'
    );

    assert.strictEqual(
      creditCalls.filter(
        call => call[0] === 'reserve'
      ).length,
      1
    );

    const removeCall =
      storageCalls.find(
        call =>
          call[0] === 'remove' &&
          call[1].paths[0] ===
            dangerousPath
      );

    assert.ok(removeCall);

    console.log(
      'PASS: attachment completion, security, and credit unit tests'
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
