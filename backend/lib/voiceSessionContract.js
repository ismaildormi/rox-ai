'use strict';

const { config } = require('./audioOperationRegistry');

function sessionError(code) { const error = new Error(code); error.code = code; return error; }

function normalizeVoiceSessionRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw sessionError('invalid_voice_session_request');
  if (value.microphoneConsent !== true) throw sessionError('microphone_consent_required');
  if (value.continuousListening === true) throw sessionError('continuous_listening_disabled');
  if (value.backgroundRecording === true) throw sessionError('background_recording_disabled');
  if (value.storeRawAudio === true) throw sessionError('raw_audio_storage_disabled');
  const maxSeconds = value.maxSeconds === undefined ? 300 : value.maxSeconds;
  if (!Number.isInteger(maxSeconds) || maxSeconds < 1 || maxSeconds > config.requestLimits.maxVoiceSessionSeconds) throw sessionError('invalid_voice_session_duration');
  return Object.freeze({
    microphoneConsent: true, continuousListening: false, backgroundRecording: false,
    storeRawAudio: false, visibleRecordingIndicator: true, stopControl: true, maxSeconds
  });
}

module.exports = { normalizeVoiceSessionRequest };
