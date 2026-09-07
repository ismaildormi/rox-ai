'use strict';

const crypto = require('node:crypto');
const { config, ipError, normalizeIpActionType, assertIpExecutionAvailable } = require('./ipCapabilityRegistry');

function normalizeIpAction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw ipError('invalid_ip_action');
  const type = normalizeIpActionType(value.type);
  const target = value.target === undefined ? null : String(value.target).trim();
  if (target && target.length > 500) throw ipError('ip_action_target_too_long');
  const input = value.input === undefined ? null : String(value.input);
  if (input && input.length > 4000) throw ipError('ip_action_input_too_long');
  const definition = config.actions[type];
  return Object.freeze({ id: value.id && /^[a-zA-Z0-9_-]{1,80}$/.test(value.id) ? value.id : crypto.randomUUID(), type, target, input, scope: definition.scope, risk: definition.risk, requiresConfirmation: definition.requiresConfirmation, reversible: definition.reversible });
}

function actionDigest(action) {
  const normalized = normalizeIpAction(action);
  return crypto.createHash('sha256').update(JSON.stringify({ type: normalized.type, target: normalized.target, input: normalized.input })).digest('hex');
}

function buildConfirmationChallenge(action, { now = Date.now() } = {}) {
  const normalized = normalizeIpAction(action);
  if (!normalized.requiresConfirmation) throw ipError('ip_confirmation_not_required');
  return Object.freeze({ challengeId: crypto.randomUUID(), actionId: normalized.id, actionDigest: actionDigest(normalized), phraseRequired: normalized.risk === 'critical' ? config.confirmation.criticalPhrase : null, expiresAt: new Date(now + config.confirmation.challengeSeconds * 1000).toISOString(), singleUse: true });
}

function assertIpActionExecutable({ action, permissionGrant, confirmation, now = Date.now() }) {
  const normalized = normalizeIpAction(action);
  assertIpExecutionAvailable();
  if (!permissionGrant || !permissionGrant.scopes?.includes(normalized.scope)) throw ipError('ip_permission_scope_missing', normalized.scope);
  if (normalized.requiresConfirmation && (!confirmation || confirmation.approved !== true || confirmation.actionDigest !== actionDigest(normalized))) throw ipError('ip_action_confirmation_required');
  if (confirmation && Date.parse(confirmation.expiresAt) <= now) throw ipError('ip_confirmation_expired');
  return normalized;
}

module.exports = { normalizeIpAction, actionDigest, buildConfirmationChallenge, assertIpActionExecutable };
