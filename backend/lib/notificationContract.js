'use strict';

const { config } = require('./finalProductRegistry');

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function normalizeNotification(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_notification');
  if (!config.notificationTypes.includes(input.type)) fail('invalid_notification_type');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 120) fail('invalid_notification_title');
  if (typeof input.message !== 'string' || !input.message.trim() || input.message.trim().length > 1000) fail('invalid_notification_message');
  const serialized = `${input.title}\n${input.message}`;
  if (/(?:bearer\s+|password|secret|api[_-]?key|access[_-]?token|cookie)/i.test(serialized)) fail('notification_sensitive_content');
  return { type: input.type, title: input.title.trim(), message: input.message.trim(), read: false, deliveredExternally: false };
}
module.exports = { normalizeNotification };
