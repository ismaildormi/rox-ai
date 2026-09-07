'use strict';
const assert = require('node:assert/strict');
const { normalizeVoiceSessionRequest } = require('./lib/voiceSessionContract');

const session = normalizeVoiceSessionRequest({ microphoneConsent: true, maxSeconds: 300 });
assert.equal(session.continuousListening, false);
assert.equal(session.backgroundRecording, false);
assert.equal(session.storeRawAudio, false);
assert.equal(session.visibleRecordingIndicator, true);
assert.equal(session.stopControl, true);
assert.throws(() => normalizeVoiceSessionRequest({}), { code: 'microphone_consent_required' });
assert.throws(() => normalizeVoiceSessionRequest({ microphoneConsent: true, continuousListening: true }), { code: 'continuous_listening_disabled' });
assert.throws(() => normalizeVoiceSessionRequest({ microphoneConsent: true, backgroundRecording: true }), { code: 'background_recording_disabled' });
assert.throws(() => normalizeVoiceSessionRequest({ microphoneConsent: true, storeRawAudio: true }), { code: 'raw_audio_storage_disabled' });
console.log('PASS: Pack 07 Voice Chat requires consent, visible recording and STOP with no background retention');
