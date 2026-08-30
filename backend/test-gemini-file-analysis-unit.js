'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  MAX_GEMINI_PDF_BYTES,
  canAnalyzeWithGemini,
  analyzeGeminiAttachment
} = require('./lib/geminiFileAnalysis');

function fakeResponse({ status = 200, headers = {}, json = {} } = {}) {
  const normalized = new Map(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      value
    ])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return normalized.get(String(name).toLowerCase()) || null;
      }
    },
    async json() {
      return json;
    }
  };
}

async function run() {
  assert.strictEqual(
    canAnalyzeWithGemini({
      mimeType: 'audio/mpeg',
      sizeBytes: 600 * 1024 * 1024,
      result: { status: 'provider_required' }
    }),
    true
  );
  assert.strictEqual(
    canAnalyzeWithGemini({
      mimeType: 'application/pdf',
      sizeBytes: MAX_GEMINI_PDF_BYTES + 1,
      result: { status: 'provider_required' }
    }),
    false
  );
  assert.strictEqual(
    canAnalyzeWithGemini({
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 1024,
      result: { status: 'provider_required' }
    }),
    false
  );

  const tempDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'zuvyr-gemini-test-')
  );
  const filePath = path.join(tempDir, 'sample.mp3');
  const body = Buffer.from('ID3-safe-audio-test');
  await fsp.writeFile(filePath, body);

  const calls = [];
  let uploadedBytes = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      assert.strictEqual(options.method, 'POST');
      assert.strictEqual(
        options.headers['X-Goog-Upload-Header-Content-Length'],
        String(body.length)
      );
      return fakeResponse({
        headers: {
          'x-goog-upload-url': 'https://upload.example/session'
        }
      });
    }
    if (calls.length === 2) {
      assert.strictEqual(options.duplex, 'half');
      for await (const chunk of options.body) {
        uploadedBytes += chunk.length;
      }
      return fakeResponse({
        json: {
          file: {
            name: 'files/safe-audio',
            uri: 'https://files.example/safe-audio',
            state: 'PROCESSING'
          }
        }
      });
    }
    if (calls.length === 3) {
      return fakeResponse({
        json: {
          name: 'files/safe-audio',
          uri: 'https://files.example/safe-audio',
          state: 'ACTIVE'
        }
      });
    }
    if (calls.length === 4) {
      const request = JSON.parse(options.body);
      assert.strictEqual(request.store, false);
      assert.strictEqual(request.input[0].type, 'audio');
      assert.strictEqual(request.input[0].mime_type, 'audio/mpeg');
      assert.strictEqual(
        options.headers['Api-Revision'],
        '2026-05-20'
      );
      return fakeResponse({
        json: {
          steps: [
            {
              type: 'model_output',
              content: [
                { type: 'text', text: 'Faithful audio transcript.' }
              ]
            }
          ],
          usage: { total_tokens: 42 }
        }
      });
    }
    if (calls.length === 5) {
      assert.strictEqual(options.method, 'DELETE');
      assert.ok(url.endsWith('/v1beta/files/safe-audio'));
      return fakeResponse();
    }
    throw new Error('Unexpected fetch call ' + calls.length);
  };

  try {
    const result = await analyzeGeminiAttachment({
      filePath,
      fileName: 'sample.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: body.length,
      apiKey: 'test-key-not-secret',
      model: 'gemini-test-model',
      fetchImpl,
      pollIntervalMs: 0,
      processingTimeoutMs: 1000
    });
    assert.strictEqual(uploadedBytes, body.length);
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.mode, 'gemini_audio');
    assert.strictEqual(result.text, 'Faithful audio transcript.');
    assert.strictEqual(result.provider, 'google-gemini');
    assert.strictEqual(result.model, 'gemini-test-model');
    assert.deepStrictEqual(result.usage, { total_tokens: 42 });
    assert.deepStrictEqual(result.providerFileDeletion(), {
      attempted: true,
      succeeded: true
    });
    assert.strictEqual(calls.length, 5);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }

  console.log(
    'PASS: private streaming Gemini file analysis unit tests'
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});