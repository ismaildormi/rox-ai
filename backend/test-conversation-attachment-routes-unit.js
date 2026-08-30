'use strict';

const assert = require('assert');
const express = require('express');
const {
  createConversationRouter
} = require('./lib/conversationRoutes');

const CONVERSATION_ID =
  '11111111-1111-4111-8111-111111111111';

async function run() {
  const calls = [];
  const storageCalls = [];

  const store = {
    async requireOwnedConversation(
      conversationId,
      ownerId
    ) {
      calls.push([
        'require',
        {
          conversationId,
          ownerId
        }
      ]);

      return {
        id: conversationId,
        owner_id: ownerId,
        feature: 'chat',
        title: 'Attachment chat'
      };
    },

    async listAssets(input) {
      calls.push(['assets', input]);

      return [
        {
          id: 'asset-file',
          conversation_id: input.conversationId,
          owner_id: input.ownerId,
          asset_type: 'file',
          storage_bucket: 'conversation-files',
          storage_path:
            `${input.ownerId}/${input.conversationId}/report.pdf`,
          mime_type: 'application/pdf',
          original_name: 'report.pdf',
          file_size_bytes: 2048,
          scan_status: 'clean',
          extraction_status: 'ready',
          metadata: {}
        },
        {
          id: 'asset-output',
          conversation_id: input.conversationId,
          owner_id: input.ownerId,
          asset_type: 'image',
          url: 'https://assets.example/generated.png',
          storage_path: null,
          mime_type: 'image/png',
          original_name: 'generated.png',
          scan_status: 'clean',
          extraction_status: 'not_required',
          metadata: {}
        }
      ];
    }
  };

  const bucket = {
    async createSignedUploadUrl(
      storagePath,
      options
    ) {
      storageCalls.push([
        'upload',
        {
          storagePath,
          options
        }
      ]);

      return {
        data: {
          path: storagePath,
          token: 'signed-upload-token'
        },
        error: null
      };
    },

    async createSignedUrl(
      storagePath,
      expiresIn
    ) {
      storageCalls.push([
        'download',
        {
          storagePath,
          expiresIn
        }
      ]);

      return {
        data: {
          signedUrl:
            `https://private.example/${storagePath}`
        },
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

  const app = express();

  app.use(express.json());

  app.use((req, res, next) => {
    req.userId = 'owner-123';
    next();
  });

  app.use(
    '/api/conversations',
    createConversationRouter({
      store,
      storage
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
    let response = await fetch(
      `${baseUrl}/${CONVERSATION_ID}` +
      '/assets/upload-url',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          fileName: 'music-track.mp3',
          mimeType: 'audio/mpeg',
          sizeBytes: 4096
        })
      }
    );

    assert.strictEqual(response.status, 201);

    let body = await response.json();

    assert.strictEqual(body.status, 'success');
    assert.strictEqual(
      body.attachment.assetType,
      'audio'
    );
    assert.strictEqual(
      body.attachment.scanStatus,
      'pending'
    );
    assert.strictEqual(
      body.upload.bucket,
      'conversation-files'
    );
    assert.strictEqual(
      body.upload.token,
      'signed-upload-token'
    );
    assert.ok(
      body.upload.path.endsWith(
        '-music-track.mp3'
      )
    );
    assert.strictEqual(
      storageCalls.filter(
        call => call[0] === 'upload'
      ).length,
      1
    );

    response = await fetch(
      `${baseUrl}/${CONVERSATION_ID}` +
      '/assets/upload-url',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          fileName: 'malware.exe',
          mimeType: 'application/octet-stream',
          sizeBytes: 4096
        })
      }
    );

    assert.strictEqual(response.status, 415);

    body = await response.json();

    assert.strictEqual(
      body.code,
      'dangerous_attachment_type'
    );

    assert.strictEqual(
      storageCalls.filter(
        call => call[0] === 'upload'
      ).length,
      1
    );

    response = await fetch(
      `${baseUrl}/${CONVERSATION_ID}/assets`
    );

    assert.strictEqual(response.status, 200);

    body = await response.json();

    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.items.length, 2);
    assert.strictEqual(
      body.items[0].access_url,
      'https://private.example/' +
      'owner-123/' +
      CONVERSATION_ID +
      '/report.pdf'
    );
    assert.strictEqual(
      body.items[1].access_url,
      'https://assets.example/generated.png'
    );

    const listCall =
      calls.find(call => call[0] === 'assets');

    assert.strictEqual(
      listCall[1].scanStatus,
      'clean'
    );
    assert.strictEqual(
      listCall[1].ownerId,
      'owner-123'
    );

    response = await fetch(
      `${baseUrl}/invalid-id/assets`
    );

    assert.strictEqual(response.status, 400);

    console.log(
      'PASS: private conversation attachment route unit tests'
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
