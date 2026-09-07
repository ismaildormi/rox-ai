'use strict';

const { config, normalizeAudioOperation } = require('./audioOperationRegistry');

function artifactError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function httpsUrl(value, code) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch (_) { throw artifactError(code); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw artifactError(code);
  return parsed.toString();
}

function normalizeAudioArtifact(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw artifactError('invalid_audio_artifact');
  const operation = normalizeAudioOperation(value.operation);
  const durationSeconds = Number(value.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > config.requestLimits.maxDurationSeconds) throw artifactError('invalid_audio_artifact_duration');
  const mimeType = String(value.mimeType || '').toLowerCase();
  const allowedMime = operation === 'audio_to_video'
    ? ['video/mp4', 'video/webm']
    : config.requestLimits.allowedOutputFormats.map(format => format === 'mp3' ? 'audio/mpeg' : `audio/${format}`);
  if (!allowedMime.includes(mimeType)) throw artifactError('invalid_audio_artifact_mime');
  return Object.freeze({
    operation,
    url: httpsUrl(value.url, 'invalid_audio_artifact_url'),
    previewUrl: value.previewUrl ? httpsUrl(value.previewUrl, 'invalid_audio_preview_url') : null,
    mimeType,
    durationSeconds,
    transcript: typeof value.transcript === 'string' ? value.transcript.slice(0, 200000) : null
  });
}

module.exports = { normalizeAudioArtifact };
