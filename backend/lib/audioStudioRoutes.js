'use strict';

const express = require('express');
const { publicInventory, assertAudioOperationAvailable } = require('./audioOperationRegistry');
const { normalizeAudioRequest } = require('./audioRequestContract');
const { buildAudioJobSnapshot } = require('./audioJobContract');
const { normalizeVoiceSessionRequest } = require('./voiceSessionContract');

function statusFor(error) {
  return ['audio_operation_unpriced', 'audio_operation_disabled'].includes(error.code) ? 503 : 400;
}

function createAudioStudioRouter() {
  const router = express.Router();
  router.get('/capabilities', (_req, res) => res.json({ status: 'success', ...publicInventory() }));
  router.post('/requests/validate', (req, res) => {
    try { return res.json({ status: 'success', request: normalizeAudioRequest(req.body) }); }
    catch (error) { return res.status(statusFor(error)).json({ status: 'error', code: error.code || 'invalid_audio_request', message: 'Audio request validation failed.' }); }
  });
  router.post('/jobs/request', (req, res) => {
    try {
      const request = normalizeAudioRequest(req.body);
      assertAudioOperationAvailable(request.operation);
      const job = buildAudioJobSnapshot({ userId: req.userId, requestId: req.headers['idempotency-key'], request });
      return res.status(501).json({ status: 'error', code: 'audio_provider_unavailable', job });
    } catch (error) {
      return res.status(statusFor(error)).json({ status: 'error', code: error.code || 'audio_operation_disabled', operation: error.operation, message: 'Audio provider execution is not enabled.' });
    }
  });
  router.post('/voice/sessions/request', (req, res) => {
    try {
      const session = normalizeVoiceSessionRequest(req.body);
      assertAudioOperationAvailable('voice_chat');
      return res.status(501).json({ status: 'error', code: 'voice_provider_unavailable', session });
    } catch (error) {
      return res.status(statusFor(error)).json({ status: 'error', code: error.code || 'voice_chat_disabled', message: 'Voice Chat is not enabled.' });
    }
  });
  return router;
}

module.exports = { createAudioStudioRouter };
