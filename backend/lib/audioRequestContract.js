'use strict';

const { config, normalizeAudioOperation } = require('./audioOperationRegistry');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

function requestError(code, field) {
  const error = new Error(code);
  error.code = code;
  if (field) error.field = field;
  return error;
}

function optionalText(value, field, max) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw requestError(`invalid_${field}`, field);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw requestError(`invalid_${field}`, field);
  return normalized;
}

function optionalUuid(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw requestError(`invalid_${field}`, field);
  return value.toLowerCase();
}

function normalizeAudioRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw requestError('invalid_audio_request');
  const operation = normalizeAudioOperation(value.operation);
  const definition = config.operations[operation];
  const prompt = optionalText(value.prompt, 'audio_prompt', config.requestLimits.maxPromptCharacters);
  const text = optionalText(value.text, 'speech_text', config.requestLimits.maxSpeechCharacters);
  const sourceAudioAssetId = optionalUuid(value.sourceAudioAssetId, 'source_audio_asset_id');
  const conversationId = optionalUuid(value.conversationId, 'conversation_id');
  const language = optionalText(value.language, 'audio_language', 12);
  if (language && !LANGUAGE_PATTERN.test(language)) throw requestError('invalid_audio_language', 'language');
  if (definition.requiresPrompt && !prompt) throw requestError('audio_prompt_required', 'prompt');
  if (definition.requiresText && !text) throw requestError('speech_text_required', 'text');
  if (definition.requiresSourceAudio && !sourceAudioAssetId) throw requestError('source_audio_asset_required', 'sourceAudioAssetId');
  if (definition.requiresConsent && value.microphoneConsent !== true) throw requestError('microphone_consent_required', 'microphoneConsent');

  const durationSeconds = value.durationSeconds === undefined ? null : value.durationSeconds;
  if (durationSeconds !== null && (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > config.requestLimits.maxDurationSeconds)) {
    throw requestError('invalid_audio_duration', 'durationSeconds');
  }
  const outputFormat = String(value.outputFormat || (operation === 'audio_to_video' ? 'mp4' : 'mp3')).toLowerCase();
  const allowedFormats = operation === 'audio_to_video' ? config.requestLimits.allowedVideoFormats : config.requestLimits.allowedOutputFormats;
  if (!allowedFormats.includes(outputFormat)) throw requestError('invalid_audio_output_format', 'outputFormat');
  const sampleRate = value.sampleRate === undefined ? null : value.sampleRate;
  if (sampleRate !== null && !config.requestLimits.allowedSampleRates.includes(sampleRate)) throw requestError('invalid_audio_sample_rate', 'sampleRate');
  const visualAssetIds = value.visualAssetIds === undefined ? [] : value.visualAssetIds;
  if (!Array.isArray(visualAssetIds) || visualAssetIds.length > config.requestLimits.maxVisualAssets) throw requestError('invalid_visual_asset_ids', 'visualAssetIds');
  const normalizedVisuals = [...new Set(visualAssetIds.map(id => optionalUuid(id, 'visual_asset_id')))];
  if (operation !== 'audio_to_video' && normalizedVisuals.length) throw requestError('visual_assets_audio_to_video_only', 'visualAssetIds');

  return Object.freeze({
    operation, prompt, text, sourceAudioAssetId, conversationId, language,
    voiceId: optionalText(value.voiceId, 'voice_id', 120),
    durationSeconds, outputFormat, sampleRate,
    subtitles: value.subtitles === true,
    visualAssetIds: Object.freeze(normalizedVisuals),
    microphoneConsent: value.microphoneConsent === true
  });
}

module.exports = { requestError, normalizeAudioRequest };
