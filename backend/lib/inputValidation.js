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
const ALLOWED_AI_LANGUAGES =
  new Set(['auto', 'ar', 'fr', 'en', 'es']);

const ALLOWED_AI_LENGTHS =
  new Set(['concise', 'balanced', 'detailed']);

const ALLOWED_AI_TONES =
  new Set(['natural', 'professional', 'creative']);

function badRequest(res, message) {
  return res.status(400).json({ status: 'error', message });
}

/** Mount before gatekeeperMiddleware on POST /api/chat. */
function validateChatBody(req, res, next) {
  const { messages, feature, aiPreferences } = req.body || {};

  if (feature !== undefined && !ALLOWED_FEATURES.has(feature)) {
    return badRequest(res, `feature must be one of: ${[...ALLOWED_FEATURES].join(', ')}`);
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
  const { prompt } = req.body || {};
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return badRequest(res, 'prompt must be a non-empty string.');
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return badRequest(res, `prompt exceeds the limit of ${MAX_PROMPT_CHARS} characters.`);
  }
  next();
}

module.exports = { validateChatBody, validatePromptBody };
