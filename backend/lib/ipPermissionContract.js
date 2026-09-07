'use strict';

const { config, ipError } = require('./ipCapabilityRegistry');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizePermissionGrant(value, { now = Date.now() } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw ipError('invalid_ip_permission_grant');
  if (!UUID.test(String(value.deviceId || ''))) throw ipError('invalid_ip_device_id');
  if (!UUID.test(String(value.sessionId || ''))) throw ipError('invalid_ip_session_id');
  if (value.explicitConsent !== true) throw ipError('ip_permission_consent_required');
  if (!Array.isArray(value.scopes) || value.scopes.length < 1 || value.scopes.length > 9) throw ipError('invalid_ip_permission_scopes');
  const scopes = [...new Set(value.scopes.map(scope => String(scope || '').trim()))];
  if (scopes.some(scope => scope === '*' || !Object.hasOwn(config.permissionScopes, scope))) throw ipError('unknown_ip_permission_scope');
  const expiresAtMs = Date.parse(String(value.expiresAt || ''));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) throw ipError('invalid_ip_permission_expiry');
  for (const scope of scopes) {
    const max = config.permissionScopes[scope].maxGrantSeconds * 1000;
    if (expiresAtMs - now > max) throw ipError('ip_permission_expiry_too_long', scope);
  }
  return Object.freeze({ deviceId: String(value.deviceId).toLowerCase(), sessionId: String(value.sessionId).toLowerCase(), scopes: Object.freeze(scopes), explicitConsent: true, issuedAt: new Date(now).toISOString(), expiresAt: new Date(expiresAtMs).toISOString() });
}

function assertScopeGranted(grant, scope, { now = Date.now() } = {}) {
  const normalized = normalizePermissionGrant({ ...grant, explicitConsent: true }, { now });
  if (!normalized.scopes.includes(scope)) throw ipError('ip_permission_scope_missing', scope);
  return true;
}

module.exports = { normalizePermissionGrant, assertScopeGranted };
