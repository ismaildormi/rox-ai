'use strict';

const { config, normalizeVideoOperation } = require('./videoOperationRegistry');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LANGUAGE = /^(?:auto|[a-z]{2,3}(?:-[a-z]{2})?)$/i;

function requestError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function optionalUuid(value, code) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value);
  if (!UUID.test(normalized)) throw requestError(code);
  return normalized;
}

function normalizeLanguage(value, fallback) {
  const normalized = String(value || fallback).trim();
  if (!LANGUAGE.test(normalized)) throw requestError('invalid_video_language');
  return normalized.toLowerCase();
}

function normalizeVideoRequest(body = {}) {
  const operation = normalizeVideoOperation(body.videoOperation);
  const definition = config.operations[operation];
  const prompt = String(body.prompt || '').trim();
  if (definition.requiresPrompt && !prompt) throw requestError('video_prompt_required');
  if (prompt.length > config.requestLimits.maxPromptCharacters) {
    throw requestError('video_prompt_too_long');
  }

  const sourceImageAssetId = optionalUuid(body.sourceImageAssetId, 'invalid_video_source_image');
  const sourceVideoAssetId = optionalUuid(body.sourceVideoAssetId, 'invalid_video_source_video');
  const startFrameAssetId = optionalUuid(body.startFrameAssetId, 'invalid_video_start_frame');
  const endFrameAssetId = optionalUuid(body.endFrameAssetId, 'invalid_video_end_frame');

  if (definition.requiresSourceImage && !sourceImageAssetId && !startFrameAssetId) {
    throw requestError('video_source_image_required');
  }
  if (definition.requiresSourceVideo && !sourceVideoAssetId) {
    throw requestError('video_source_video_required');
  }
  if (endFrameAssetId && !startFrameAssetId) {
    throw requestError('video_start_frame_required');
  }

  const raw = body.videoOptions;
  if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw))) {
    throw requestError('invalid_video_options');
  }
  const options = raw || {};
  const allowed = new Set([
    'durationSeconds', 'ratio', 'resolution', 'fps', 'audio', 'seed',
    'subtitleLanguage', 'targetLanguage', 'exportFormat'
  ]);
  if (Object.keys(options).some(key => !allowed.has(key))) {
    throw requestError('unsupported_video_option');
  }

  const durationSeconds = options.durationSeconds === undefined
    ? 5
    : Number(options.durationSeconds);
  const ratio = String(options.ratio || '16:9');
  const resolution = String(options.resolution || '720p').toLowerCase();
  const fps = options.fps === undefined ? 24 : Number(options.fps);
  const audio = options.audio === undefined ? false : options.audio;
  const seed = options.seed === undefined || options.seed === null
    ? null
    : Number(options.seed);
  const exportFormat = String(options.exportFormat || 'mp4').toLowerCase();

  if (!config.requestLimits.allowedDurationSeconds.includes(durationSeconds)) {
    throw requestError('invalid_video_duration');
  }
  if (!config.requestLimits.allowedRatios.includes(ratio)) {
    throw requestError('invalid_video_ratio');
  }
  if (!config.requestLimits.allowedResolutions.includes(resolution)) {
    throw requestError('invalid_video_resolution');
  }
  if (!config.requestLimits.allowedFps.includes(fps)) {
    throw requestError('invalid_video_fps');
  }
  if (typeof audio !== 'boolean') throw requestError('invalid_video_audio');
  if (seed !== null && (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647)) {
    throw requestError('invalid_video_seed');
  }
  if (!config.requestLimits.allowedExportFormats.includes(exportFormat)) {
    throw requestError('invalid_video_export_format');
  }

  return Object.freeze({
    operation,
    prompt,
    sourceImageAssetId,
    sourceVideoAssetId,
    startFrameAssetId,
    endFrameAssetId,
    options: Object.freeze({
      durationSeconds,
      ratio,
      resolution,
      fps,
      audio,
      seed,
      subtitleLanguage: normalizeLanguage(options.subtitleLanguage, 'auto'),
      targetLanguage: normalizeLanguage(options.targetLanguage, 'auto'),
      exportFormat
    })
  });
}

module.exports = { normalizeVideoRequest };
