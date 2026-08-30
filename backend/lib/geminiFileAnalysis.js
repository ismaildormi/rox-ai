'use strict';

const fs = require('fs');

const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL =
  process.env.GEMINI_ATTACHMENT_MODEL ||
  'gemini-3.7-flash';
const MAX_GEMINI_PDF_BYTES = 50 * 1024 * 1024;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_PROCESSING_TIMEOUT_MS = 30 * 60 * 1000;

const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  'audio/wav',
  'audio/mp3',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'audio/mpeg',
  'audio/m4a',
  'audio/l16',
  'audio/opus',
  'audio/alaw',
  'audio/mulaw',
  'audio/webm'
]);

const SUPPORTED_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/mpeg',
  'video/mov',
  'video/avi',
  'video/x-flv',
  'video/mpg',
  'video/webm',
  'video/wmv',
  'video/3gpp'
]);

function providerError(code, message = code, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function normalizeMimeType(value) {
  return String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function mediaTypeForMime(mimeType) {
  const normalized = normalizeMimeType(mimeType);
  if (SUPPORTED_AUDIO_MIME_TYPES.has(normalized)) return 'audio';
  if (SUPPORTED_VIDEO_MIME_TYPES.has(normalized)) return 'video';
  if (normalized === 'application/pdf') return 'document';
  return null;
}

function canAnalyzeWithGemini({ mimeType, sizeBytes, result } = {}) {
  const normalizedSize = Number(sizeBytes);
  const mediaType = mediaTypeForMime(mimeType);
  if (!result || result.status !== 'provider_required') return false;
  if (!mediaType || !Number.isFinite(normalizedSize) || normalizedSize < 1) {
    return false;
  }
  if (mediaType === 'document') {
    return normalizedSize <= MAX_GEMINI_PDF_BYTES;
  }
  return true;
}

async function readJsonResponse(response, code) {
  let body = null;
  try {
    body = await response.json();
  } catch (_error) {
    body = null;
  }
  if (!response.ok) {
    throw providerError(
      code,
      body?.error?.message || code,
      { status: response.status }
    );
  }
  return body || {};
}

function responseText(payload) {
  const parts = [];
  for (const step of Array.isArray(payload.steps) ? payload.steps : []) {
    if (step && step.type !== 'model_output') continue;
    for (const content of Array.isArray(step?.content) ? step.content : []) {
      if (content?.type === 'text' && typeof content.text === 'string') {
        parts.push(content.text);
      }
    }
  }
  if (!parts.length && typeof payload.output_text === 'string') {
    parts.push(payload.output_text);
  }
  return parts.join('\n').trim();
}

function promptForMediaType(mediaType) {
  if (mediaType === 'audio') {
    return 'Transcribe and analyze this audio faithfully. Identify language, speakers when possible, key sections, music or sound characteristics, and important details. Return clear Markdown suitable for later question answering. Do not invent inaudible content.';
  }
  if (mediaType === 'video') {
    return 'Analyze this video faithfully using both visuals and audio. Describe key scenes, spoken content, on-screen text, important events, and timestamps when useful. Return clear Markdown suitable for later question answering. Do not invent unseen content.';
  }
  return 'Read this PDF using document vision and OCR. Extract its meaningful text, tables, charts, images, structure, and key facts faithfully. Return clear Markdown suitable for later question answering. State clearly when content is unreadable.';
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function analyzeGeminiAttachment({
  filePath,
  fileName,
  mimeType,
  sizeBytes,
  fetchImpl = fetch,
  apiKey = process.env.GOOGLE_API_KEY,
  model = DEFAULT_MODEL,
  pollIntervalMs = Number(
    process.env.GEMINI_FILE_POLL_INTERVAL_MS ||
    DEFAULT_POLL_INTERVAL_MS
  ),
  processingTimeoutMs = Number(
    process.env.GEMINI_FILE_PROCESSING_TIMEOUT_MS ||
    DEFAULT_PROCESSING_TIMEOUT_MS
  )
} = {}) {
  const normalizedMime = normalizeMimeType(mimeType);
  const mediaType = mediaTypeForMime(normalizedMime);
  const normalizedSize = Number(sizeBytes);
  const normalizedKey = String(apiKey || '').trim();

  if (!normalizedKey) throw providerError('gemini_api_key_missing');
  if (!filePath || !fs.existsSync(filePath)) {
    throw providerError('gemini_source_file_missing');
  }
  if (!mediaType) throw providerError('gemini_media_type_unsupported');
  if (!Number.isInteger(normalizedSize) || normalizedSize < 1) {
    throw providerError('gemini_file_size_invalid');
  }
  if (
    mediaType === 'document' &&
    normalizedSize > MAX_GEMINI_PDF_BYTES
  ) {
    throw providerError('gemini_pdf_too_large');
  }

  const apiHeaders = { 'x-goog-api-key': normalizedKey };
  let uploadedName = null;
  let deletionAttempted = false;
  let deletionSucceeded = false;

  try {
    const startResponse = await fetchImpl(
      GEMINI_BASE_URL + '/upload/v1beta/files',
      {
        method: 'POST',
        headers: {
          ...apiHeaders,
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(normalizedSize),
          'X-Goog-Upload-Header-Content-Type': normalizedMime,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          file: { display_name: String(fileName || 'attachment') }
        })
      }
    );
    if (!startResponse.ok) {
      await readJsonResponse(startResponse, 'gemini_upload_start_failed');
    }
    const uploadUrl = startResponse.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw providerError('gemini_upload_url_missing');

    const uploadResponse = await fetchImpl(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Length': String(normalizedSize),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize'
      },
      body: fs.createReadStream(filePath),
      duplex: 'half'
    });
    const uploadPayload = await readJsonResponse(
      uploadResponse,
      'gemini_upload_failed'
    );
    let uploadedFile = uploadPayload.file || uploadPayload;
    uploadedName = String(uploadedFile.name || '').trim();
    if (!uploadedName || !uploadedFile.uri) {
      throw providerError('gemini_uploaded_file_invalid');
    }

    const startedAt = Date.now();
    while (
      String(uploadedFile.state || '').toUpperCase() === 'PROCESSING'
    ) {
      if (Date.now() - startedAt >= processingTimeoutMs) {
        throw providerError('gemini_file_processing_timeout');
      }
      await wait(pollIntervalMs);
      const fileResponse = await fetchImpl(
        GEMINI_BASE_URL + '/v1beta/' + uploadedName,
        { headers: apiHeaders }
      );
      uploadedFile = await readJsonResponse(
        fileResponse,
        'gemini_file_status_failed'
      );
    }
    if (
      uploadedFile.state &&
      String(uploadedFile.state).toUpperCase() !== 'ACTIVE'
    ) {
      throw providerError('gemini_file_processing_failed');
    }

    const interactionResponse = await fetchImpl(
      GEMINI_BASE_URL + '/v1beta/interactions',
      {
        method: 'POST',
        headers: {
          ...apiHeaders,
          'Api-Revision': '2026-05-20',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          store: false,
          input: [
            {
              type: mediaType,
              uri: uploadedFile.uri,
              mime_type: normalizedMime
            },
            {
              type: 'text',
              text: promptForMediaType(mediaType)
            }
          ]
        })
      }
    );
    const interaction = await readJsonResponse(
      interactionResponse,
      'gemini_interaction_failed'
    );
    const text = responseText(interaction);
    if (!text) throw providerError('gemini_empty_response');

    return {
      status: 'ready',
      mode: 'gemini_' + mediaType,
      text,
      provider: 'google-gemini',
      model,
      usage: interaction.usage || null,
      providerFileDeletion: () => ({
        attempted: deletionAttempted,
        succeeded: deletionSucceeded
      })
    };
  } finally {
    if (uploadedName) {
      deletionAttempted = true;
      try {
        const deleteResponse = await fetchImpl(
          GEMINI_BASE_URL + '/v1beta/' + uploadedName,
          {
            method: 'DELETE',
            headers: apiHeaders
          }
        );
        deletionSucceeded = deleteResponse.ok;
      } catch (_error) {
        deletionSucceeded = false;
      }
    }
  }
}

module.exports = {
  GEMINI_BASE_URL,
  DEFAULT_MODEL,
  MAX_GEMINI_PDF_BYTES,
  SUPPORTED_AUDIO_MIME_TYPES,
  SUPPORTED_VIDEO_MIME_TYPES,
  providerError,
  normalizeMimeType,
  mediaTypeForMime,
  canAnalyzeWithGemini,
  responseText,
  analyzeGeminiAttachment
};