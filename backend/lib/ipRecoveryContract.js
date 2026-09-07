'use strict';

const crypto = require('node:crypto');
const { config, ipError, normalizeIpActionType } = require('./ipCapabilityRegistry');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function buildStopSignal(value, { now = Date.now() } = {}) {
  if (!value || !UUID.test(String(value.sessionId || ''))) throw ipError('invalid_ip_stop_session');
  return Object.freeze({ id: crypto.randomUUID(), sessionId: value.sessionId.toLowerCase(), requestedAt: new Date(now).toISOString(), stopAccepted: true, executionWasActive: false, deviceCommandSent: false });
}

function normalizeUndoReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw ipError('invalid_ip_undo_receipt');
  const actionType = normalizeIpActionType(value.actionType);
  if (config.actions[actionType].reversible !== true) throw ipError('ip_action_not_reversible');
  if (typeof value.actionId !== 'string' || !value.actionId.trim()) throw ipError('invalid_ip_undo_action_id');
  if (typeof value.backupArtifactId !== 'string' || !UUID.test(value.backupArtifactId)) throw ipError('ip_undo_backup_required');
  return Object.freeze({ actionId: value.actionId.trim(), actionType, backupArtifactId: value.backupArtifactId.toLowerCase(), requiresConfirmation: true, executable: false });
}

module.exports = { buildStopSignal, normalizeUndoReceipt };
