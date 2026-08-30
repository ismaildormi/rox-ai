// ROX AI ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Worker (hardened)
//
// Credits are now reserved by server.js BEFORE the job is even enqueued
// (see handleGenerationRequest), so this worker no longer charges
// anything on success ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â that already happened. What it's responsible
// for now: if a job exhausts every retry, refund the exact reservation
// tied to that job's requestId, so a failed generation never costs the
// user credits. That refund + a log-only 'error' entry is recorded
// through gatekeeper.js.
//
// Run as its own process, separate from server.js:
//   node worker.js

require('dotenv').config({ path: __dirname + '/.env' });
const {
  validateWorkerEnvironment,
  reportEnvironmentValidation,
} = require('./lib/envValidation');

reportEnvironmentValidation(
  validateWorkerEnvironment(process.env),
  { component: 'worker' }
);
const { Worker, UnrecoverableError } = require('bullmq');
const Replicate = require('replicate');
const { generateImage } = require('./src/modules/ai/providers/imageProviders');
const { connection } = require('./lib/queue');
const { supabaseAdmin } = require('./lib/supabaseAdmin');
const { refundCredits, logCreditEvent, reportRefundFailure } = require('./gatekeeper');
const { recordRefund } = require('./lib/metrics');
const {
  completeGenerationConversation,
  failGenerationConversation
} = require('./lib/conversationGeneration');
const conversationMemory = require('./lib/conversationMemory');
const {
  createAttachmentJobProcessor
} = require('./lib/attachmentWorker');

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 2);
const ATTACHMENT_WORKER_CONCURRENCY = Math.max(
  1,
  Number(process.env.ATTACHMENT_WORKER_CONCURRENCY || 1)
);

async function markJob(jobId, patch) {
  await supabaseAdmin.from('generation_jobs').update(patch).eq('id', jobId);
}

const baseAttachmentJobProcessor =
  createAttachmentJobProcessor({
    store: conversationMemory,
    storage: supabaseAdmin.storage
  });

const NON_RETRYABLE_ATTACHMENT_ERRORS = new Set([
  'dangerous_attachment_content',
  'blocked_attachment_type',
  'attachment_password_protected',
  'attachment_size_mismatch',
  'invalid_attachment_path'
]);

async function processAttachmentJob(job) {
  try {
    return await baseAttachmentJobProcessor(job);
  } catch (error) {
    if (
      NON_RETRYABLE_ATTACHMENT_ERRORS.has(
        String(error.code || error.message || '')
      )
    ) {
      const fatal =
        new UnrecoverableError(error.message);
      fatal.code = error.code;
      throw fatal;
    }

    throw error;
  }
}

// Deliberately NOT pinning a specific version hash here. A pinned hash
// (owner/model:64-hex-version) silently 404s the moment that exact
// version is retired/renamed on Replicate ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the previous version of
// this file had exactly that bug (a truncated SDXL hash and a
// video-model hash that didn't match any real version). Using the bare
// "owner/model" form always resolves to that model's current default
// version, which is what replicate.run()/the JS client recommends for
// anything long-running. If you need a pinned version for reproducible
// output, verify the exact hash on the model's Replicate page first.
const IMAGE_MODEL = 'black-forest-labs/flux-schnell';
const VIDEO_MODEL = process.env.REPLICATE_VIDEO_MODEL || 'wan-video/wan-2.2-t2v-fast'; // real text-to-video model ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â takes { prompt }, not an image

async function processImageJob(job) {
  const {
    jobRowId,
    requestId,
    userId,
    prompt,
    conversationId = null,
    memoryRequestKey = null
  } = job.data;

  await markJob(jobRowId, {
    status: 'processing',
    started_at: new Date().toISOString()
  });

  const result = await generateImage(prompt);
  let memoryResult = null;

  if (conversationId) {
    try {
      memoryResult = await completeGenerationConversation({
        conversationId,
        ownerId: userId,
        feature: 'image',
        resultUrl: result.url,
        requestKey: memoryRequestKey || requestId || jobRowId,
        provider: result.provider || null,
        model: result.model || null
      });
    } catch (memoryError) {
      console.error(
        '[worker-memory] image completion save failed:',
        memoryError.message
      );
    }
  }

  await markJob(jobRowId, {
    status: 'done',
    result_url: result.url,
    response_message_id:
      memoryResult?.assistantMessage?.id || null,
    completed_at: new Date().toISOString()
  });

  // Credits were already reserved before enqueue.
}

async function processVideoJob(job) {
  const {
    jobRowId,
    requestId,
    userId,
    prompt,
    conversationId = null,
    memoryRequestKey = null
  } = job.data;

  await markJob(jobRowId, {
    status: 'processing',
    started_at: new Date().toISOString()
  });

  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('replicate_video_provider_not_configured');
  }

  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN
  });

  const output = await replicate.run(
    VIDEO_MODEL,
    { input: { prompt } }
  );

  const resultUrl =
    Array.isArray(output)
      ? output[0]
      : output;

  let memoryResult = null;

  if (conversationId) {
    try {
      memoryResult = await completeGenerationConversation({
        conversationId,
        ownerId: userId,
        feature: 'video',
        resultUrl,
        requestKey: memoryRequestKey || requestId || jobRowId,
        provider: 'replicate',
        model: VIDEO_MODEL
      });
    } catch (memoryError) {
      console.error(
        '[worker-memory] video completion save failed:',
        memoryError.message
      );
    }
  }

  await markJob(jobRowId, {
    status: 'done',
    result_url: resultUrl,
    response_message_id:
      memoryResult?.assistantMessage?.id || null,
    completed_at: new Date().toISOString()
  });
}

const imageWorker = new Worker('rox-image-generation', processImageJob, {
  connection,
  concurrency: CONCURRENCY,
});

const videoWorker = new Worker('rox-video-generation', processVideoJob, {
  connection,
  concurrency: Math.max(1, Math.floor(CONCURRENCY / 2)), // video is heavier ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â fewer parallel jobs
});

const attachmentWorker = new Worker(
  'zuvyr-attachment-processing',
  processAttachmentJob,
  {
    connection,
    concurrency: ATTACHMENT_WORKER_CONCURRENCY
  }
);

async function handleAttachmentFailure(job, err) {
  const attempts = Number(job.opts.attempts || 1);
  const exhausted =
    err.name === 'UnrecoverableError' ||
    job.attemptsMade >= attempts;

  if (!exhausted) return;

  const {
    assetId,
    ownerId,
    storageBucket,
    storagePath,
    creditRequestId
  } = job.data;
  const code = String(err.code || err.message || '');
  const rejected =
    code === 'dangerous_attachment_content' ||
    code === 'blocked_attachment_type';

  try {
    await conversationMemory.updateAssetProcessing({
      assetId,
      ownerId,
      scanStatus: rejected ? 'rejected' : 'failed',
      extractionStatus: 'failed'
    });
  } catch (stateError) {
    console.error(
      '[attachment-worker] failure state save failed:',
      stateError.message
    );
  }

  if (rejected && storageBucket && storagePath) {
    await supabaseAdmin.storage
      .from(storageBucket)
      .remove([storagePath])
      .catch(() => null);
  }

  try {
    await refundCredits(creditRequestId);
    recordRefund('chat');
  } catch (refundErr) {
    await reportRefundFailure({
      requestId: creditRequestId,
      userId: ownerId,
      feature: 'chat',
      error: refundErr
    });
  }

  await logCreditEvent({
    userId: ownerId,
    feature: 'chat',
    status: 'error',
    requestId: creditRequestId + ':detail',
    errorMessage: err.message
  });
}

// ---------- Failure handling: refund only once retries are exhausted ----------
async function handleJobFailure(job, err, feature) {
  const {
    jobRowId,
    userId,
    requestId,
    conversationId = null,
    memoryRequestKey = null
  } = job.data;

  const attemptsMade = job.attemptsMade;
  const maxAttempts = job.opts.attempts;

  if (attemptsMade < maxAttempts) {
    // BullMQ will retry automatically. Do not save failure or refund yet.
    return;
  }

  let failureMessage = null;

  if (conversationId) {
    try {
      failureMessage = await failGenerationConversation({
        conversationId,
        ownerId: userId,
        feature,
        errorMessage: err.message,
        requestKey: memoryRequestKey || requestId || jobRowId
      });
    } catch (memoryError) {
      console.error(
        `[worker-memory] ${feature} failure save failed:`,
        memoryError.message
      );
    }
  }

  await markJob(jobRowId, {
    status: 'failed',
    error_message: err.message,
    response_message_id: failureMessage?.id || null,
    completed_at: new Date().toISOString()
  });

  try {
    await refundCredits(requestId);
    recordRefund(feature);
  } catch (refundErr) {
    await reportRefundFailure({
      requestId,
      userId,
      feature,
      error: refundErr
    });
  }

  await logCreditEvent({
    userId,
    feature,
    status: 'error',
    requestId: `${requestId}:detail`,
    errorMessage: err.message
  });

  console.error(
    `[worker] job ${job.id} (${feature}) exhausted retries, refunded:`,
    err.message,
    err.attempts ? JSON.stringify(err.attempts) : ''
  );
}

imageWorker.on('failed', (job, err) => handleJobFailure(job, err, 'image'));
videoWorker.on('failed', (job, err) => handleJobFailure(job, err, 'video'));
attachmentWorker.on('failed', (job, err) =>
  handleAttachmentFailure(job, err)
);

console.log(`ROX AI worker running (concurrency: image=${CONCURRENCY}, video=${Math.max(1, Math.floor(CONCURRENCY / 2))}, attachment=${ATTACHMENT_WORKER_CONCURRENCY})`);

