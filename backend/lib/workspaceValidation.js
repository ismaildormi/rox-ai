'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function object(value, code = 'invalid_workspace_object') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function text(value, { code, max, optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string') fail(code || 'invalid_workspace_text');
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalized)) fail(code || 'invalid_workspace_text');
  return normalized;
}

function uuid(value, code = 'invalid_workspace_id') {
  if (typeof value !== 'string' || !UUID.test(value)) fail(code);
  return value.toLowerCase();
}

function uniqueStrings(value, { code, allowed, max } = {}) {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) fail(code);
  const normalized = value.map(entry => text(entry, { code, max: 120 }));
  if (new Set(normalized).size !== normalized.length || normalized.includes('*')) fail(code);
  if (allowed && normalized.some(entry => !allowed.includes(entry))) fail(code);
  return normalized;
}

module.exports = { fail, object, text, uuid, uniqueStrings };
