'use strict';

const config = require('../config/chat-system.v1.json');

function capabilityError(code, mode) {
  const error = new Error(code);
  error.code = code;
  error.mode = mode;
  return error;
}

function normalizeChatMode(value) {
  const mode = String(value || 'standard').trim().toLowerCase();
  if (!Object.hasOwn(config.modes, mode)) throw capabilityError('unknown_chat_mode', mode);
  return mode;
}

function isModeEnabled(mode, env = process.env) {
  const normalized = normalizeChatMode(mode);
  const definition = config.modes[normalized];
  if (!definition.environmentVariable) return definition.enabledByDefault === true;
  const raw = env[definition.environmentVariable];
  return raw === undefined ? definition.enabledByDefault === true : raw === 'true';
}

function assertChatModeAvailable(mode, { env = process.env } = {}) {
  const normalized = normalizeChatMode(mode);
  const definition = config.modes[normalized];
  if (definition.status === 'blocked_unpriced') throw capabilityError('chat_mode_unpriced', normalized);
  if (!isModeEnabled(normalized, env)) throw capabilityError('chat_mode_disabled', normalized);
  return Object.freeze({ mode: normalized, capability: definition.capability, status: definition.status });
}

module.exports = { config, normalizeChatMode, isModeEnabled, assertChatModeAvailable };
