// ROX AI — src/modules/notifications
// Extension point for "Notifications" (flag: notifications). Channels
// (push, email, in-app, webhook-as-notification) register here the
// same way AI providers/tools do — one registry pattern, see
// src/core/registry.js.

const registry = require('../../core/registry');

function registerChannel(key, definition /* { send(userId, message) } */) {
  registry.register('notifications.channels', key, definition);
}

async function notify(/* userId, message, channels = [] */) {
  return { sent: false, reason: 'not_implemented' };
}

module.exports = { registerChannel, notify };
