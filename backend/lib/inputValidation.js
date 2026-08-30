// ROX AI — lib/inputValidation.js
//
// Nothing previously capped the SHAPE of a request body once a caller
// was authenticated. A valid (even legitimate) user could still send:
//   - a `messages` array with thousands of entries
//   - a single message containing megabytes of text
//   - a `feature` value that isn't one of the real routes
// None of that is blocked by the per-user rate limit (which counts
// requests, not size) — one oversized request is enough to inflate
// model cost/latency or tie up a worker. Validate and reject BEFORE
// gatekeeper.reserveCredits() runs, so a malformed request never even
// costs the user a credit or shows up as a "spend" to chase down.

const MAX_MESSAGES = Number(process.env.MAX_MESSAGES_PER_CHAT || 40);
const MAX_CHARS_PER_MESSAGE = Number(process.env.MAX_CHARS_PER_MESSAGE || 8000);
const MAX_TOTAL_CHARS = Number(process.env.MAX_TOTAL_CHARS_PER_CHAT || 24000);
const MAX_PROMPT_CHARS = Number(process.env.MAX_PROMPT_CHARS || 2000);

const ALLOWED_FEATURES = new Set(['chat', 'code']);
const ALLOWED_ROLES = new Set(['user', 'assistant', 'system']);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_AI_LANGUAGES =
  new Set(['auto', 'ar', 'fr', 'en', 'es', 'zh']);

const ALLOWED_AI_LENGTHS =
  new Set(['concise', 'balanced', 'detailed']);

const ALLOWED_AI_TONES =
  new Set(['natural', 'professional', 'creative']);

function badRequest(res, message) {
  return res.status(400).json({ status: 'error', message });
}

function validateConversationReferences(body, res) {
  for (const field of ['conversationId', 'turnId']) {
    const value = body[field];

    if (value === undefined) continue;

    if (
      typeof value !== 'string' ||
      !UUID_PATTERN.test(value)
    ) {
      badRequest(res, `${field} must be a valid UUID.`);
      return false;
    }
  }

  return true;
}

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);
const MAX_IMAGE_ATTACHMENT_BYTES = 1300 * 1024;

function validateImageAttachment(attachment, feature, res) {
  if (attachment === undefined || attachment === null) return true;
  if (feature !== 'chat') {
    badRequest(res, 'attachments are supported in chat only.');
    return false;
  }
  if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
    badRequest(res, 'attachment must be an object.');
    return false;
  }
  const keys = Object.keys(attachment);
  if (keys.some(key => !['kind','name','mimeType','dataUrl','size'].includes(key))) {
    badRequest(res, 'attachment contains unsupported fields.');
    return false;
  }
  if (attachment.kind !== 'image') {
    badRequest(res, 'attachment kind must be image.');
    return false;
  }
  if (typeof attachment.name !== 'string' || attachment.name.length < 1 || attachment.name.length > 160) {
    badRequest(res, 'attachment name is invalid.');
    return false;
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.has(attachment.mimeType)) {
    badRequest(res, 'unsupported image type.');
    return false;
  }
  if (typeof attachment.dataUrl !== 'string') {
    badRequest(res, 'attachment data is invalid.');
    return false;
  }
  const match = attachment.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[1] !== attachment.mimeType) {
    badRequest(res, 'attachment data URL is invalid.');
    return false;
  }
  const estimatedBytes = Math.floor(match[2].length * 3 / 4) - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
  if (estimatedBytes < 1 || estimatedBytes > MAX_IMAGE_ATTACHMENT_BYTES) {
    badRequest(res, 'image attachment exceeds the size limit.');
    return false;
  }
  if (!Number.isInteger(attachment.size) || attachment.size < 1 || attachment.size > MAX_IMAGE_ATTACHMENT_BYTES) {
    badRequest(res, 'attachment size is invalid.');
    return false;
  }
  return true;
}

function validateAttachmentIds(body, feature, res) {
  const value = body.attachmentIds;

  if (value === undefined || value === null) {
    return true;
  }

  if (feature !== 'chat') {
    badRequest(
      res,
      'attachmentIds are supported in chat only.'
    );
    return false;
  }

  if (!Array.isArray(value)) {
    badRequest(res, 'attachmentIds must be an array.');
    return false;
  }

  if (value.length > 20) {
    badRequest(
      res,
      'attachmentIds supports at most 20 files.'
    );
    return false;
  }

  const seen = new Set();

  for (const raw of value) {
    if (
      typeof raw !== 'string' ||
      !UUID_PATTERN.test(raw)
    ) {
      badRequest(
        res,
        'every attachment id must be a valid UUID.'
      );
      return false;
    }

    seen.add(raw);
  }

  const ids = [...seen];

  if (ids.length && !body.conversationId) {
    badRequest(
      res,
      'attachmentIds require conversationId.'
    );
    return false;
  }

  if (body.attachment && ids.length) {
    badRequest(
      res,
      'legacy attachment and attachmentIds cannot be combined.'
    );
    return false;
  }

  return true;
}
/** Mount before gatekeeperMiddleware on POST /api/chat. */
function validateChatBody(req, res, next) {
  const body = req.body || {};
  const { messages, feature, aiPreferences } = body;

  if (!validateConversationReferences(body, res)) {
    return;
  }

  if (feature !== undefined && !ALLOWED_FEATURES.has(feature)) {
    return badRequest(res, `feature must be one of: ${[...ALLOWED_FEATURES].join(', ')}`);
  }

  if (!validateImageAttachment(body.attachment, feature, res)) {
    return;
  }

  if (!validateAttachmentIds(body, feature, res)) {
    return;
  }

  if (aiPreferences !== undefined) {
    if (
      !aiPreferences ||
      typeof aiPreferences !== 'object' ||
      Array.isArray(aiPreferences)
    ) {
      return badRequest(
        res,
        'aiPreferences must be an object.'
      );
    }

    const {
      language,
      length,
      tone
    } = aiPreferences;

    if (
      language !== undefined &&
      !ALLOWED_AI_LANGUAGES.has(language)
    ) {
      return badRequest(
        res,
        'invalid AI response language.'
      );
    }

    if (
      length !== undefined &&
      !ALLOWED_AI_LENGTHS.has(length)
    ) {
      return badRequest(
        res,
        'invalid AI response length.'
      );
    }

    if (
      tone !== undefined &&
      !ALLOWED_AI_TONES.has(tone)
    ) {
      return badRequest(
        res,
        'invalid AI response tone.'
      );
    }
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return badRequest(res, 'messages must be a non-empty array.');
  }
  if (messages.length > MAX_MESSAGES) {
    return badRequest(res, `messages exceeds the limit of ${MAX_MESSAGES}.`);
  }

  let totalChars = 0;
  for (const m of messages) {
    if (!m || typeof m !== 'object' || typeof m.content !== 'string' || !ALLOWED_ROLES.has(m.role)) {
      return badRequest(res, 'each message needs a valid role and string content.');
    }
    if (m.content.length > MAX_CHARS_PER_MESSAGE) {
      return badRequest(res, `a single message exceeds the limit of ${MAX_CHARS_PER_MESSAGE} characters.`);
    }
    totalChars += m.content.length;
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    return badRequest(res, `combined message length exceeds the limit of ${MAX_TOTAL_CHARS} characters.`);
  }

  next();
}

/** Mount before gatekeeperMiddleware on POST /api/generate-image and /api/generate-video. */
function validatePromptBody(req, res, next) {
  const body = req.body || {};
  const { prompt } = body;

  if (!validateConversationReferences(body, res)) {
    return;
  }

  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return badRequest(res, 'prompt must be a non-empty string.');
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return badRequest(res, `prompt exceeds the limit of ${MAX_PROMPT_CHARS} characters.`);
  }
  next();
}

module.exports = {
  validateChatBody,
  validatePromptBody,
  validateConversationReferences,
  validateAttachmentIds
};
