'use strict';

const crypto = require('node:crypto');
const { config, ipError } = require('./ipCapabilityRegistry');

function redact(value, key = '') {
  if (config.audit.redactedKeyFragments.some(fragment => key.toLowerCase().includes(fragment))) return '[REDACTED]';
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redact(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  if (typeof value === 'string') return value.slice(0, 2000);
  return value;
}

function buildIpAuditEvent(value, { now = Date.now() } = {}) {
  if (!value || !config.audit.eventTypes.includes(value.eventType)) throw ipError('invalid_ip_audit_event');
  const details = redact(value.details || {});
  if (Buffer.byteLength(JSON.stringify(details), 'utf8') > config.audit.maxEventBytes) throw ipError('ip_audit_event_too_large');
  return Object.freeze({ id: crypto.randomUUID(), sessionId: value.sessionId || null, actionId: value.actionId || null, eventType: value.eventType, details: Object.freeze(details), createdAt: new Date(now).toISOString() });
}

module.exports = { redact, buildIpAuditEvent };
