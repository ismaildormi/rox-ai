'use strict';

const { config } = require('./videoOperationRegistry');
const { normalizeVideoUrl } = require('./videoArtifactContract');

const TRANSITIONS = Object.freeze({
  queued: new Set(['processing', 'failed', 'cancelled']),
  processing: new Set(['done', 'failed', 'cancelled']),
  done: new Set(),
  failed: new Set(),
  cancelled: new Set()
});

function jobError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeProgress(value) {
  const progress = Number(value ?? 0);
  if (!Number.isInteger(progress) || progress < 0 || progress > config.jobs.maxProgressPercent) {
    throw jobError('invalid_video_job_progress');
  }
  return progress;
}

function assertVideoJobTransition(from, to) {
  if (!TRANSITIONS[from] || !TRANSITIONS[to]) throw jobError('unknown_video_job_state');
  if (!TRANSITIONS[from].has(to)) throw jobError('invalid_video_job_transition');
  return true;
}

function optionalUrl(value) {
  return value ? normalizeVideoUrl(value) : null;
}

function buildVideoJobSnapshot(row = {}) {
  if (!config.jobs.states.includes(row.status)) throw jobError('unknown_video_job_state');
  const stage = row.job_stage || row.status;
  if (!config.jobs.stages.includes(stage)) throw jobError('unknown_video_job_stage');
  const estimatedSeconds = row.estimated_seconds == null
    ? null
    : Number(row.estimated_seconds);
  if (
    estimatedSeconds !== null &&
    (!Number.isInteger(estimatedSeconds) || estimatedSeconds < 0 || estimatedSeconds > 86400)
  ) throw jobError('invalid_video_job_estimate');
  return Object.freeze({
    status: row.status,
    feature: row.feature,
    result_url: optionalUrl(row.result_url),
    preview_url: optionalUrl(row.preview_url),
    export_url: optionalUrl(row.export_url),
    error_message: row.error_message || null,
    video_operation: row.video_operation || null,
    progress_percent: normalizeProgress(row.progress_percent),
    job_stage: stage,
    estimated_seconds: estimatedSeconds,
    cancel_requested: Boolean(row.cancel_requested),
    response_message_id: row.response_message_id || null,
    created_at: row.created_at || null,
    completed_at: row.completed_at || null
  });
}

module.exports = { normalizeProgress, assertVideoJobTransition, buildVideoJobSnapshot };
