'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const {
  ATTACHMENT_BUCKET,
  MAX_ATTACHMENT_BYTES,
  isBlockedAttachment,
  validateUploadRequest
} = require('./conversationAttachments');
const {
  detectFileType,
  extractAttachment,
  hasExecutableMagic
} = require('./attachmentExtraction');
const {
  isChunkableTextFile,
  streamTextChunks,
  textEncoding
} = require('./attachmentChunking');
const {
  canAnalyzeWithGemini,
  analyzeGeminiAttachment
} = require('./geminiFileAnalysis');
const {
  canProcessDocumentWithTools,
  extractDocumentWithTools
} = require('./documentToolExtraction');

const DEFAULT_MAX_BUFFERED_BYTES =
  96 * 1024 * 1024;
const HEAD_BYTES = 8192;
const SIGNED_URL_SECONDS = 7200;

function workerError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireJobString(value, code) {
  const normalized = String(value || '').trim();
  if (!normalized) throw workerError(code);
  return normalized;
}

async function streamToPrivateTemp({
  response,
  expectedBytes,
  tempRoot
}) {
  if (!response || !response.ok || !response.body) {
    throw workerError(
      'attachment_download_failed',
      'The private attachment download failed.'
    );
  }

  const tempDir = await fsp.mkdtemp(
    path.join(tempRoot, 'zuvyr-attachment-')
  );
  const tempFile = path.join(tempDir, 'payload.bin');
  const hash = crypto.createHash('sha256');
  const headChunks = [];
  let headLength = 0;
  let receivedBytes = 0;

  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;

      if (
        receivedBytes > expectedBytes ||
        receivedBytes > MAX_ATTACHMENT_BYTES
      ) {
        callback(
          workerError(
            'attachment_size_mismatch',
            'Attachment size changed during download.'
          )
        );
        return;
      }

      hash.update(chunk);

      if (headLength < HEAD_BYTES) {
        const part = chunk.subarray(
          0,
          Math.min(
            chunk.length,
            HEAD_BYTES - headLength
          )
        );
        headChunks.push(part);
        headLength += part.length;
      }

      callback(null, chunk);
    }
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body),
      meter,
      fs.createWriteStream(tempFile, {
        flags: 'wx',
        mode: 0o600
      })
    );

    if (receivedBytes !== expectedBytes) {
      throw workerError(
        'attachment_size_mismatch',
        'Attachment size does not match its metadata.'
      );
    }

    return {
      tempDir,
      tempFile,
      receivedBytes,
      sha256: hash.digest('hex'),
      head: Buffer.concat(headChunks)
    };
  } catch (error) {
    await fsp.rm(tempDir, {
      recursive: true,
      force: true
    });
    throw error;
  }
}

function extractionStatus(result) {
  if (result.status === 'ready') return 'ready';
  if (result.status === 'provider_required') {
    return 'pending';
  }
  return 'unsupported';
}

function createAttachmentJobProcessor({
  store,
  storage,
  fetchImpl = fetch,
  tempRoot =
    process.env.ATTACHMENT_TEMP_DIR ||
    os.tmpdir(),
  maxBufferedBytes =
    Number(
      process.env.MAX_ATTACHMENT_WORKER_BUFFER_BYTES ||
      DEFAULT_MAX_BUFFERED_BYTES
    ),
  analyzeWithProvider = analyzeGeminiAttachment,
  extractWithDocumentTools = extractDocumentWithTools
} = {}) {
  if (!store || !storage) {
    throw workerError(
      'attachment_worker_dependencies_missing'
    );
  }

  return async function processAttachmentJob(job) {
    const data =
      job && job.data && typeof job.data === 'object'
        ? job.data
        : {};

    const assetId =
      requireJobString(
        data.assetId,
        'invalid_attachment_asset_id'
      );
    const conversationId =
      requireJobString(
        data.conversationId,
        'invalid_attachment_conversation_id'
      );
    const ownerId =
      requireJobString(
        data.ownerId,
        'invalid_attachment_owner_id'
     );
    const storageBucket =
      requireJobString(
        data.storageBucket,
        'invalid_attachment_bucket'
      );
    const storagePath =
      requireJobString(
        data.storagePath,
        'invalid_attachment_path'
     );
    const creditRequestId =
      requireJobString(
        data.creditRequestId,
        'invalid_attachment_credit_request'
      );

    if (
      storageBucket !== ATTACHMENT_BUCKET ||
      !storagePath.startsWith(
        ownerId + '/' + conversationId + '/'
      ) ||
      storagePath.includes('/../') ||
      storagePath.includes('/./')
    ) {
      throw workerError('invalid_attachment_path');
    }

    const attachment = validateUploadRequest({
      fileName: data.fileName,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes
    });

    await store.updateAssetProcessing({
      assetId,
      ownerId,
      scanStatus: 'scanning',
      extractionStatus: 'processing'
    });

    const bucket = storage.from(storageBucket);
    const signed = await bucket.createSignedUrl(
      storagePath,
      SIGNED_URL_SECONDS
    );

    if (
      signed.error ||
      !signed.data ||
      !signed.data.signedUrl
    ) {
      throw workerError(
        'attachment_signed_download_failed'
      );
    }
    const timeoutMs = Number(
      process.env.ATTACHMENT_DOWNLOAD_TIMEOUT_MS ||
      3600000
    );
    const response = await fetchImpl(
      signed.data.signedUrl,
      {
        signal: AbortSignal.timeout(timeoutMs)
      }
    );

    let downloaded = null;

    try {
      downloaded = await streamToPrivateTemp({
        response,
        expectedBytes: attachment.sizeBytes,
        tempRoot
      });
      if (hasExecutableMagic(downloaded.head)) {
        throw workerError(
          'dangerous_attachment_content',
          'Executable file content is blocked.'
        );
      }
      const detected =
        await detectFileType(downloaded.head);
      if (
        detected &&
        isBlockedAttachment({
          fileName:
            'detected.' + (detected.ext || 'bin'),
          mimeType: detected.mime
        })
      ) {
        throw workerError(
          'dangerous_attachment_content',
          'Executable file content is blocked.'
        );
      }
      let result;
      if (
        downloaded.receivedBytes <=
        maxBufferedBytes
      ) {
        const buffer =
          await fsp.readFile(downloaded.tempFile);
        result = await extractAttachment({
          buffer,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType
        });
      } else if (
        typeof store.replaceAssetChunks === 'function' &&
        isChunkableTextFile({
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          head: downloaded.head
        })
      ) {
        let preview = '';
        let observedChunks = 0;
        const sourceChunks = streamTextChunks({
          filePath: downloaded.tempFile,
          encoding: textEncoding(downloaded.head)
        });

        async function* trackChunks() {
          for await (const chunk of sourceChunks) {
            observedChunks += 1;
            if (preview.length < 120000) {
              preview += chunk.content.slice(
                0,
                120000 - preview.length
              );
            }
            yield chunk;
          }
        }

        const chunkWrite = await store.replaceAssetChunks({
          assetId,
          conversationId,
          ownerId,
          chunks: trackChunks()
        });

        if (
          !chunkWrite ||
          chunkWrite.chunkCount !== observedChunks ||
          observedChunks < 1
        ) {
          throw workerError(
            'attachment_chunk_index_incomplete'
          );
        }

        result = {
          status: 'ready',
          mode: 'chunked_text',
          text: preview,
          chunked: true,
          chunkCount: observedChunks
        };
      } else {
        result = {
          status: 'provider_required',
          mode:
            attachment.assetType === 'file'
              ? 'large_file'
              : attachment.assetType,
          text: '',
          reason:
            'Large content is ready for chunked or provider analysis.'
        };
      }
      if (
        canProcessDocumentWithTools({
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          result
        })
      ) {
        const documentResult =
          await extractWithDocumentTools({
            filePath: downloaded.tempFile,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            tempDir: downloaded.tempDir
          });

        if (
          documentResult.status === 'ready' &&
          documentResult.textFile &&
          typeof store.replaceAssetChunks === 'function'
        ) {
          let preview = '';
          let observedChunks = 0;
          const sourceChunks = streamTextChunks({
            filePath: documentResult.textFile,
            encoding: 'utf8'
          });

          async function* trackDocumentChunks() {
            for await (const chunk of sourceChunks) {
              observedChunks += 1;
              if (preview.length < 120000) {
                preview += chunk.content.slice(
                  0,
                  120000 - preview.length
                );
              }
              yield {
                ...chunk,
                metadata: {
                  ...chunk.metadata,
                  extraction_mode: documentResult.mode,
                  page_count:
                    Number(documentResult.pageCount) || 0,
                  ocr_pages:
                    Number(documentResult.ocrPages) || 0
                }
              };
            }
          }

          const chunkWrite =
            await store.replaceAssetChunks({
              assetId,
              conversationId,
              ownerId,
              chunks: trackDocumentChunks()
            });

          if (
            !chunkWrite ||
            chunkWrite.chunkCount !== observedChunks ||
            observedChunks < 1
          ) {
            throw workerError(
              'attachment_document_chunk_index_incomplete'
            );
          }

          result = {
            ...documentResult,
            mode: documentResult.mode,
            text: preview,
            chunked: true,
            chunkCount: observedChunks
          };
        } else {
          result = documentResult;
        }
      }
      if (
        result.status === 'provider_required' &&
        canAnalyzeWithGemini({
          mimeType: attachment.mimeType,
          sizeBytes: downloaded.receivedBytes,
          result
        })
      ) {
        result = await analyzeWithProvider({
          filePath: downloaded.tempFile,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: downloaded.receivedBytes
        });
      }

      const finalAsset =
        await store.updateAssetProcessing({
          assetId,
          ownerId,
          scanStatus: 'clean',
          extractionStatus:
            extractionStatus(result),
          sha256: downloaded.sha256,
          metadata: {
            kind: 'source',
            uploaded_by_user: true,
            processing_mode: 'queued',
            extraction_mode: result.mode,
            extraction_reason:
              result.reason || null,
            extracted_text: result.text || '',
            chunked: result.chunked === true,
            chunk_count: Number(result.chunkCount) || 0,
            detected_mime_type:
              detected ? detected.mime : null,
            detected_extension:
              detected ? detected.ext : null,
            credit_request_id: creditRequestId,
            ingest_credits:
              Number(data.ingestCredits) || 1,
            extraction_provider:
              result.provider || null,
            extraction_model:
              result.model || null,
            provider_usage:
              result.usage || null,
            provider_file_deletion:
              typeof result.providerFileDeletion === 'function'
                ? result.providerFileDeletion()
                : null
          }
        });
      return {
        status: result.status,
        asset: finalAsset,
        sha256: downloaded.sha256
      };
    } finally {
      if (downloaded && downloaded.tempDir) {
        await fsp.rm(downloaded.tempDir, {
          recursive: true,
          force: true
        });
      }
    }
  };
}

module.exports = {
  DEFAULT_MAX_BUFFERED_BYTES,
  HEAD_BYTES,
  SIGNED_URL_SECONDS,
  workerError,
  streamToPrivateTemp,
  createAttachmentJobProcessor
};
