'use strict';

const crypto = require('crypto');
const express = require('express');
const conversationMemory = require('./conversationMemory');
const {
  ATTACHMENT_BUCKET,
  MAX_ATTACHMENT_BYTES,
  validateUploadRequest,
  buildStoragePath
} = require('./conversationAttachments');
const {
  inspectAttachmentBuffer,
  extractAttachment
} = require('./attachmentExtraction');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_SYNC_ATTACHMENT_BYTES =
  50 * 1024 * 1024;

function isConversationId(value) {
  return UUID_PATTERN.test(String(value || ''));
}

function sendConversationError(res, error, operation) {
  const code = String(error && (error.code || error.message) || '');
  const expectedStatus =
    Number(error && error.statusCode);

  if (
    Number.isInteger(expectedStatus) &&
    expectedStatus >= 400 &&
    expectedStatus < 500
  ) {
    return res.status(expectedStatus).json({
      status: 'error',
      code,
      message:
        error && error.message
          ? error.message
          : 'Invalid attachment request.'
    });
  }

  if (code === 'conversation_not_found') {
    return res.status(404).json({
      status: 'error',
      code,
      message: 'Conversation not found.'
    });
  }

  if (
    code === 'conversation_update_empty' ||
    code === 'invalid_conversation_feature' ||
    code === 'invalid_conversation_id'
  ) {
    return res.status(400).json({
      status: 'error',
      code,
      message: 'Invalid conversation request.'
    });
  }

  console.error(
    `[conversation-api] ${operation} failed:`,
    error && error.message ? error.message : error
  );

  return res.status(500).json({
    status: 'error',
    code: 'conversation_request_failed',
    message: 'Conversation request could not be completed.'
  });
}

function createConversationRouter({
  store = conversationMemory,
  storage = null,
  creditManager = null,
  attachmentQueue = null,
  attachmentJobOptions = null
} = {}) {
  const router = express.Router();

  function getStorage() {
    if (storage) return storage;

    const { supabaseAdmin } = require('./supabaseAdmin');
    return supabaseAdmin.storage;
  }

  function getCreditManager() {
    if (creditManager) return creditManager;
    return require('../gatekeeper');
  }

  function getAttachmentQueue() {
    if (attachmentQueue) return attachmentQueue;
    return require('./queue').attachmentQueue;
  }

  function getAttachmentJobOptions() {
    if (attachmentJobOptions) return attachmentJobOptions;
    return require('./queue').defaultJobOptions;
  }

  function attachmentIngestCredits() {
    const configured =
      Number(process.env.ATTACHMENT_INGEST_CREDITS || 1);

    return (
      Number.isInteger(configured) &&
      configured > 0
    )
      ? configured
      : 1;
  }

  router.get('/', async (req, res) => {
    try {
      const items = await store.listConversations({
        ownerId: req.userId,
        feature: req.query.feature,
        search: req.query.search,
        archived: req.query.archived === 'true',
        limit: req.query.limit
      });

      return res.json({
        status: 'success',
        items
      });
    } catch (error) {
      return sendConversationError(
        res,
        error,
        'list'
      );
    }
  });

  router.post('/', async (req, res) => {
    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body
        : {};

    if (
      !conversationMemory.CONVERSATION_FEATURES.has(
        String(body.feature || '').toLowerCase()
      )
    ) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_conversation_feature',
        message: 'feature must be one of: chat, code, images, videos, roxip.'
      });
    }

    if (
      body.title !== undefined &&
      typeof body.title !== 'string'
    ) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_conversation_title',
        message: 'title must be a string.'
      });
    }

    try {
      const conversation = await store.createConversation({
        ownerId: req.userId,
        feature: body.feature,
        title: body.title,
        metadata:
          body.metadata &&
          typeof body.metadata === 'object' &&
          !Array.isArray(body.metadata)
            ? body.metadata
            : {}
      });

      return res.status(201).json({
        status: 'success',
        conversation
      });
    } catch (error) {
      return sendConversationError(
        res,
        error,
        'create'
      );
    }
  });

  router.post('/:conversationId/branch', async (req, res) => {
    if (!isConversationId(req.params.conversationId)) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_conversation_id',
        message: 'Invalid conversation id.'
      });
    }

    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body
        : {};

    const throughSequence =
      body.throughSequence === undefined
        ? null
        : Number(body.throughSequence);

    if (
      throughSequence !== null &&
      (!Number.isInteger(throughSequence) || throughSequence < 1)
    ) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_branch_sequence',
        message: 'Invalid branch sequence.'
      });
    }

    try {
      const source = await store.requireOwnedConversation(
        req.params.conversationId,
        req.userId
      );

      let messages = [];
      let beforeSequence;

      while (messages.length < 1000) {
        const page = await store.listMessages({
          conversationId: source.id,
          ownerId: req.userId,
          beforeSequence,
          limit: 100
        });

        if (!page.length) break;

        messages = [...page,...messages];

        if (page.length < 100) break;

        const nextBefore = Number(page[0].sequence_no);

        if (
          !Number.isInteger(nextBefore) ||
          nextBefore < 2 ||
          nextBefore === beforeSequence
        ) break;

        beforeSequence = nextBefore;
      }

      const selected = throughSequence === null
        ? messages
        : messages.filter(
            message =>
              Number(message.sequence_no) <= throughSequence
          );

      const conversation = await store.createConversation({
        ownerId:req.userId,
        feature:source.feature,
        title:source.title+' \u2014 branch',
        metadata:{
          ...(source.metadata||{}),
          branched_from_conversation_id:source.id,
          branched_through_sequence:throughSequence
        }
      });

      for (const message of selected) {
        await store.appendMessage({
          conversationId:conversation.id,
          ownerId:req.userId,
          role:message.role,
          messageType:message.message_type,
          plainText:message.plain_text,
          content:message.content,
          metadata:{
            ...(message.metadata||{}),
            branched_from_message_id:message.id
          },
          provider:message.provider,
          model:message.model,
          requestId:
            'branch:'+source.id+':'+message.id
        });
      }

      return res.status(201).json({
        status:'success',
        conversation,
        copiedMessages:selected.length
      });
    } catch (error) {
      return sendConversationError(res,error,'branch');
    }
  });

  router.post(
    '/:conversationId/assets/upload-url',
    async (req, res) => {
      if (!isConversationId(req.params.conversationId)) {
        return res.status(400).json({
          status: 'error',
          code: 'invalid_conversation_id',
          message: 'Invalid conversation id.'
        });
      }

      const body =
        req.body &&
        typeof req.body === 'object' &&
        !Array.isArray(req.body)
          ? req.body
          : {};

      try {
        const attachment = validateUploadRequest({
          fileName: body.fileName,
          mimeType: body.mimeType,
          sizeBytes: body.sizeBytes
        });

        await store.requireOwnedConversation(
          req.params.conversationId,
          req.userId
        );

        const uploadId = crypto.randomUUID();

        const storagePath = buildStoragePath({
          ownerId: req.userId,
          conversationId: req.params.conversationId,
          uploadId,
          fileName: attachment.fileName
        });

        const bucket = getStorage()
          .from(ATTACHMENT_BUCKET);

        const { data, error } =
          await bucket.createSignedUploadUrl(
            storagePath,
            {
              upsert: false
            }
          );

        if (error || !data || !data.token) {
          const uploadError =
            new Error('attachment_upload_url_failed');
          uploadError.cause = error || null;
          throw uploadError;
        }

        return res.status(201).json({
          status: 'success',
          attachment: {
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            assetType: attachment.assetType,
            scanStatus: attachment.scanStatus,
            extractionStatus:
              attachment.extractionStatus
          },
          upload: {
            bucket: ATTACHMENT_BUCKET,
            path: storagePath,
            token: data.token,
            expiresInSeconds: 7200,
            maxBytes: MAX_ATTACHMENT_BYTES
          }
        });
      } catch (error) {
        return sendConversationError(
          res,
          error,
          'attachment-upload-url'
        );
      }
    }
  );

  router.post(
    '/:conversationId/assets/complete',
    async (req, res) => {
      if (!isConversationId(req.params.conversationId)) {
        return res.status(400).json({
          status: 'error',
          code: 'invalid_conversation_id',
          message: 'Invalid conversation id.'
        });
      }

      const body =
        req.body &&
        typeof req.body === 'object' &&
        !Array.isArray(req.body)
          ? req.body
          : {};

      let bucket = null;
      let uploadPath = null;
      let creditRequestId = null;
      let freshReservation = false;
      let creditApi = null;
      let queuedAsset = null;

      try {
        const attachment = validateUploadRequest({
          fileName: body.fileName,
          mimeType: body.mimeType,
          sizeBytes: body.sizeBytes
        });

        await store.requireOwnedConversation(
          req.params.conversationId,
          req.userId
        );

        uploadPath =
          String(body.path || '').trim();

        const expectedPrefix =
          `${req.userId}/` +
          `${req.params.conversationId}/`;

        if (
          !uploadPath.startsWith(expectedPrefix) ||
          uploadPath.includes('/../') ||
          uploadPath.includes('/./') ||
          !uploadPath.endsWith(
            `-${attachment.fileName}`
          )
        ) {
          const pathError =
            new Error('invalid_attachment_path');
          pathError.code =
            'invalid_attachment_path';
          pathError.statusCode = 400;
          throw pathError;
        }

        bucket = getStorage()
          .from(ATTACHMENT_BUCKET);

        const infoResult =
          typeof bucket.info === 'function'
            ? await bucket.info(uploadPath)
            : { data: { size: attachment.sizeBytes }, error: null };

        if (infoResult.error || !infoResult.data) {
          const uploadError =
            new Error('attachment_not_uploaded');
          uploadError.code = 'attachment_not_uploaded';
          uploadError.statusCode = 409;
          throw uploadError;
        }

        const storedSize = Number(
          infoResult.data.size ??
          infoResult.data.metadata?.size
        );

        if (
          !Number.isInteger(storedSize) ||
          storedSize < 1 ||
          storedSize > MAX_ATTACHMENT_BYTES ||
          storedSize !== attachment.sizeBytes
        ) {
          const sizeError =
            new Error('attachment_size_mismatch');
          sizeError.code = 'attachment_size_mismatch';
          sizeError.statusCode = 409;
          throw sizeError;
        }

        if (storedSize > MAX_SYNC_ATTACHMENT_BYTES) {
          creditRequestId =
            'attachment:' +
            crypto.createHash('sha256')
              .update(uploadPath)
              .digest('hex');
          creditApi = getCreditManager();
          const credits = attachmentIngestCredits();
          const reservation =
            await creditApi.reserveCredits({
              userId: req.userId,
              requestId: creditRequestId,
              feature: 'chat',
              modelUsed: 'attachment-extraction',
              creditsConsumed: credits
            });
          freshReservation = !reservation.replayed;

          queuedAsset = await store.addAsset({
            conversationId: req.params.conversationId,
            ownerId: req.userId,
            assetType: attachment.assetType,
            storagePath: uploadPath,
            storageBucket: ATTACHMENT_BUCKET,
            mimeType: attachment.mimeType,
            originalName: attachment.fileName,
            fileSizeBytes: storedSize,
            sha256: null,
            scanStatus: 'pending',
            extractionStatus: 'pending',
            metadata: {
              kind: 'source',
              uploaded_by_user: true,
              processing_mode: 'queued',
              credit_request_id: creditRequestId,
              ingest_credits: credits
            }
          });

          try {
            await getAttachmentQueue().add(
              'process',
              {
                assetId: queuedAsset.id,
                conversationId: req.params.conversationId,
                ownerId: req.userId,
                storageBucket: ATTACHMENT_BUCKET,
                storagePath: uploadPath,
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
                sizeBytes: storedSize,
                creditRequestId,
                ingestCredits: credits
              },
              {
                ...getAttachmentJobOptions(),
                jobId: queuedAsset.id
              }
            );
          } catch (queueError) {
            const unavailable =
              new Error('attachment_queue_unavailable');
            unavailable.code =
              'attachment_queue_unavailable';
            unavailable.statusCode = 503;
            unavailable.cause = queueError;
            throw unavailable;
          }

          return res.status(202).json({
            status: 'queued',
            asset: queuedAsset,
            processing: {
              status: 'pending',
              jobId: queuedAsset.id
            },
            creditsCharged: credits,
            newBalance: reservation.newBalance
          });
        }

        const {
          data: downloaded,
          error: downloadError
        } = await bucket.download(uploadPath);

        if (downloadError || !downloaded) {
          const uploadError =
            new Error('attachment_not_uploaded');
          uploadError.code =
            'attachment_not_uploaded';
          uploadError.statusCode = 409;
          throw uploadError;
        }

        let buffer;

        if (Buffer.isBuffer(downloaded)) {
          buffer = downloaded;
        } else if (
          typeof downloaded.arrayBuffer === 'function'
        ) {
          buffer = Buffer.from(
            await downloaded.arrayBuffer()
          );
        } else {
          const dataError =
            new Error('attachment_download_invalid');
          dataError.code =
            'attachment_download_invalid';
          throw dataError;
        }

        if (buffer.length !== attachment.sizeBytes) {
          const sizeError =
            new Error('attachment_size_mismatch');
          sizeError.code =
            'attachment_size_mismatch';
          sizeError.statusCode = 409;
          throw sizeError;
        }

        const inspection =
          await inspectAttachmentBuffer({
            buffer,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType
          });

        creditRequestId =
          'attachment:' +
          crypto
            .createHash('sha256')
            .update(uploadPath)
            .digest('hex');

        creditApi = getCreditManager();

        const credits =
          attachmentIngestCredits();

        const reservation =
          await creditApi.reserveCredits({
            userId: req.userId,
            requestId: creditRequestId,
            feature: 'chat',
            modelUsed:
              'attachment-extraction',
            creditsConsumed: credits
          });

        freshReservation =
          !reservation.replayed;

        const extractionResult =
          await extractAttachment({
            buffer,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType
          });

        const sha256 =
          crypto
            .createHash('sha256')
            .update(buffer)
            .digest('hex');

        const extractionStatus =
          extractionResult.status === 'ready'
            ? 'ready'
            : extractionResult.status ===
                'provider_required'
              ? 'pending'
              : 'unsupported';

        const asset =
          await store.addAsset({
            conversationId:
              req.params.conversationId,
            ownerId: req.userId,
            assetType:
              inspection.assetType,
            storagePath: uploadPath,
            storageBucket:
              ATTACHMENT_BUCKET,
            mimeType:
              inspection.detectedMimeType ||
              attachment.mimeType,
            originalName:
              attachment.fileName,
            fileSizeBytes:
              buffer.length,
            sha256,
            scanStatus: 'clean',
            extractionStatus,
            metadata: {
              kind: 'source',
              uploaded_by_user: true,
              extraction_mode:
                extractionResult.mode,
              extraction_reason:
                extractionResult.reason || null,
              extracted_text:
                extractionResult.text || '',
              detected_mime_type:
                inspection.detectedMimeType,
              detected_extension:
                inspection.detectedExtension,
              credit_request_id:
                creditRequestId,
              ingest_credits:
                credits
            }
          });

        return res.status(201).json({
          status: 'success',
          asset,
          extraction: {
            status:
              extractionResult.status,
            mode:
              extractionResult.mode,
            textAvailable:
              Boolean(extractionResult.text),
            reason:
              extractionResult.reason || null
          },
          creditsCharged: credits,
          newBalance:
            reservation.newBalance
        });
      } catch (error) {
        if (
          queuedAsset &&
          typeof store.updateAssetProcessing === 'function'
        ) {
          try {
            await store.updateAssetProcessing({
              assetId: queuedAsset.id,
              ownerId: req.userId,
              scanStatus: 'failed',
              extractionStatus: 'failed'
            });
          } catch (_) {
            // Preserve the original completion failure.
          }
        }

        if (
          freshReservation &&
          creditApi &&
          creditRequestId
        ) {
          try {
            await creditApi.refundCredits(
              creditRequestId
            );
          } catch (refundError) {
            if (
              typeof creditApi.reportRefundFailure ===
              'function'
            ) {
              await creditApi.reportRefundFailure({
                requestId: creditRequestId,
                userId: req.userId,
                feature: 'chat',
                error: refundError
              });
            }
          }
        }

        if (
          bucket &&
          uploadPath &&
          !(
            creditRequestId &&
            !freshReservation
          )
        ) {
          try {
            await bucket.remove([
              uploadPath
            ]);
          } catch (_) {
            // Best-effort quarantine cleanup.
          }
        }

        if (
          error &&
          error.code ===
            'insufficient_credits'
        ) {
          error.statusCode = 402;
          error.message =
            'Insufficient credits for attachment processing.';
        }

        if (
          error &&
          error.code === 'user_not_found'
        ) {
          error.statusCode = 403;
        }

        return sendConversationError(
          res,
          error,
          'attachment-complete'
        );
      }
    }
  );

  router.get(
    '/:conversationId/assets',
    async (req, res) => {
      if (!isConversationId(req.params.conversationId)) {
        return res.status(400).json({
          status: 'error',
          code: 'invalid_conversation_id',
          message: 'Invalid conversation id.'
        });
      }

      try {
        const assets = await store.listAssets({
          conversationId: req.params.conversationId,
          ownerId: req.userId,
          scanStatus: 'clean',
          limit: req.query.limit
        });

        const storageClient = getStorage();

        const items = await Promise.all(
          assets.map(async asset => {
            if (asset.url) {
              return {
                ...asset,
                access_url: asset.url
              };
            }

            if (!asset.storage_path) {
              return {
                ...asset,
                access_url: null
              };
            }

            const bucketName =
              asset.storage_bucket ||
              ATTACHMENT_BUCKET;

            const { data, error } =
              await storageClient
                .from(bucketName)
                .createSignedUrl(
                  asset.storage_path,
                  900
                );

            if (error || !data || !data.signedUrl) {
              return {
                ...asset,
                access_url: null
              };
            }

            return {
              ...asset,
              access_url: data.signedUrl
            };
          })
        );

        return res.json({
          status: 'success',
          items
        });
      } catch (error) {
        return sendConversationError(
          res,
          error,
          'attachment-list'
        );
      }
    }
  );

  router.patch('/:conversationId', async (req, res) => {
    if (!isConversationId(req.params.conversationId)) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_conversation_id',
        message: 'Invalid conversation id.'
      });
    }

    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body
        : {};

    if (
      body.title !== undefined &&
      typeof body.title !== 'string'
    ) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_conversation_title',
        message: 'title must be a string.'
      });
    }

    if (
      body.pinned !== undefined &&
      typeof body.pinned !== 'boolean'
    ) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_conversation_pinned',
        message: 'pinned must be a boolean.'
      });
    }

    if (
      body.archived !== undefined &&
      typeof body.archived !== 'boolean'
    ) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_conversation_archived',
        message: 'archived must be a boolean.'
      });
    }

    try {
      const conversation = await store.updateConversation({
        conversationId: req.params.conversationId,
        ownerId: req.userId,
        title: body.title,
        pinned: body.pinned,
        archived: body.archived
      });

      return res.json({
        status: 'success',
        conversation
      });
    } catch (error) {
      return sendConversationError(
        res,
        error,
        'update'
      );
    }
  });

  router.get('/:conversationId/messages', async (req, res) => {
    if (!isConversationId(req.params.conversationId)) {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_conversation_id',
        message: 'Invalid conversation id.'
      });
    }

    try {
      const messages = await store.listMessages({
        conversationId: req.params.conversationId,
        ownerId: req.userId,
        beforeSequence: req.query.beforeSequence,
        limit: req.query.limit
      });

      return res.json({
        status: 'success',
        messages,
        hasMore:
          messages.length ===
          conversationMemory.clampListLimit(req.query.limit)
      });
    } catch (error) {
      return sendConversationError(
        res,
        error,
        'messages'
      );
    }
  });

  return router;
}

module.exports = {
  MAX_SYNC_ATTACHMENT_BYTES,
  createConversationRouter,
  isConversationId
};
