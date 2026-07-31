// ROX AI Ã¢â‚¬â€ Worker (hardened)
//
// Credits are now reserved by server.js BEFORE the job is even enqueued
// (see handleGenerationRequest), so this worker no longer charges
// anything on success Ã¢â‚¬â€ that already happened. What it's responsible
// for now: if a job exhausts every retry, refund the exact reservation
// tied to that job's requestId, so a failed generation never costs the
// user credits. That refund + a log-only 'error' entry is recorded
// through gatekeeper.js.
//
// Run as its own process, separate from server.js:
//   node worker.js

require('dotenv').config();
const { Worker } = require('bullmq');
const { generateImage } = require('./src/modules/ai/providers/imageProviders');
const { connection } = require('./lib/queue');
const { supabaseAdmin } = require('./lib/supabaseAdmin');
const { refundCredits, logCreditEvent, reportRefundFailure } = require('./gatekeeper');
const { recordRefund } = require('./lib/metrics');

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 2);

async function markJob(jobId, patch) {
  await supabaseAdmin.from('generation_jobs').update(patch).eq('id', jobId);
}

// Deliberately NOT pinning a specific version hash here. A pinned hash
// (owner/model:64-hex-version) silently 404s the moment that exact
// version is retired/renamed on Replicate Ã¢â‚¬â€ the previous version of
// this file had exactly that bug (a truncated SDXL hash and a
// video-model hash that didn't match any real version). Using the bare
// "owner/model" form always resolves to that model's current default
// version, which is what replicate.run()/the JS client recommends for
// anything long-running. If you need a pinned version for reproducible
// output, verify the exact hash on the model's Replicate page first.
const IMAGE_MODEL = 'black-forest-labs/flux-schnell';
const VIDEO_MODEL = 'wan-video/wan-2.2-t2v-fast'; // real text-to-video model Ã¢â‚¬â€ takes { prompt }, not an image

async function processImageJob(job) {
  const { jobRowId, prompt } = job.data;
  await markJob(jobRowId, { status: 'processing', started_at: new Date().toISOString() });

  const result = await generateImage(prompt);

  await markJob(jobRowId, {
    status: 'done',
    result_url: result.url,
    completed_at: new Date().toISOString(),
  });
  // No credit deduction here Ã¢â‚¬â€ it was already reserved before enqueue.
}

async function processVideoJob(job) {
  const { jobRowId, prompt } = job.data;
  await markJob(jobRowId, { status: 'processing', started_at: new Date().toISOString() });

  // Previous version passed the user's TEXT prompt into `input_image`
  // on stability-ai/stable-video-diffusion Ã¢â‚¬â€ but SVD is image-to-video
  // only (it animates an existing image, it does not read text at all).
  // Since the frontend only ever collects a text prompt for this
  // feature (see rox-ai-mobile.html), the correct fix is a real
  // text-to-video model that accepts { prompt } directly.
  const output = await replicate.run(VIDEO_MODEL, { input: { prompt } });

  await markJob(jobRowId, {
    status: 'done',
    result_url: Array.isArray(output) ? output[0] : output,
    completed_at: new Date().toISOString(),
  });
}

const imageWorker = new Worker('rox-image-generation', processImageJob, {
  connection,
  concurrency: CONCURRENCY,
});

const videoWorker = new Worker('rox-video-generation', processVideoJob, {
  connection,
  concurrency: Math.max(1, Math.floor(CONCURRENCY / 2)), // video is heavier Ã¢â‚¬â€ fewer parallel jobs
});

// ---------- Failure handling: refund only once retries are exhausted ----------
async function handleJobFailure(job, err, feature) {
  const { jobRowId, userId, requestId } = job.data;
  const attemptsMade = job.attemptsMade;
  const maxAttempts = job.opts.attempts;

  if (attemptsMade < maxAttempts) {
    // BullMQ will retry this automatically (exponential backoff) Ã¢â‚¬â€ don't
    // refund or mark it failed yet, it may still succeed.
    return;
  }

  await markJob(jobRowId, {
    status: 'failed',
    error_message: err.message,
    completed_at: new Date().toISOString(),
  });

  try {
    await refundCredits(requestId);
    recordRefund(feature);
  } catch (refundErr) {
    // Must be visible Ã¢â‚¬â€ a failed refund means the user paid for a
    // generation that never happened and support needs to step in.
    // Persisted to refund_failures/system_alerts, not just this log line.
    await reportRefundFailure({ requestId, userId, feature, error: refundErr });
  }

  await logCreditEvent({
    userId,
    feature,
    status: 'error',
    requestId: `${requestId}:detail`,
    errorMessage: err.message,
  });

  console.error(`[worker] job ${job.id} (${feature}) exhausted retries, refunded:`, err.message);
}

imageWorker.on('failed', (job, err) => handleJobFailure(job, err, 'image'));
videoWorker.on('failed', (job, err) => handleJobFailure(job, err, 'video'));

console.log(`ROX AI worker running (concurrency: image=${CONCURRENCY}, video=${Math.max(1, Math.floor(CONCURRENCY / 2))})`);

