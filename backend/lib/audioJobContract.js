'use strict';

const crypto = require('node:crypto');
const { config, normalizeAudioOperation } = require('./audioOperationRegistry');
const { normalizeAudioRequest } = require('./audioRequestContract');

const TRANSITIONS = Object.freeze({
  blocked: [], queued: ['processing', 'failed', 'cancelled'], processing: ['done', 'failed', 'cancelled'], done: [], failed: [], cancelled: []
});

function jobError(code) { const error = new Error(code); error.code = code; return error; }

function buildAudioJobSnapshot({ userId, requestId, request }) {
  const normalized = normalizeAudioRequest(request);
  if (!userId || !requestId) throw jobError('audio_job_identity_required');
  return Object.freeze({
    id: crypto.randomUUID(), userId, requestId,
    operation: normalized.operation,
    status: 'blocked', stage: 'blocked', progressPercent: 0,
    pricingStatus: 'unpriced', reservationId: null,
    request: normalized
  });
}

function assertAudioJobTransition(from, to) {
  if (!Object.hasOwn(TRANSITIONS, from) || !config.jobs.states.includes(to) || !TRANSITIONS[from].includes(to)) throw jobError('invalid_audio_job_transition');
  return true;
}

function publicAudioJob(value) {
  const operation = normalizeAudioOperation(value.operation);
  if (!config.jobs.states.includes(value.status)) throw jobError('invalid_audio_job_state');
  const progressPercent = Number(value.progressPercent);
  if (!Number.isInteger(progressPercent) || progressPercent < 0 || progressPercent > 100) throw jobError('invalid_audio_job_progress');
  return Object.freeze({ id: value.id, operation, status: value.status, stage: value.stage, progressPercent });
}

module.exports = { TRANSITIONS, buildAudioJobSnapshot, assertAudioJobTransition, publicAudioJob };
