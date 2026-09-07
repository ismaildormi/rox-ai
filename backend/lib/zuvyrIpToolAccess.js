'use strict';

const crypto = require('node:crypto');
const definition = require('../config/unified-product.v1.json');

const ALLOWED_SCOPES = new Set([
  'chat.read', 'chat.propose', 'images.propose', 'video.propose', 'audio.propose',
  'code.propose', 'research.propose', 'library.read', 'projects.propose',
  'documents.propose', 'spreadsheets.propose', 'presentations.propose',
  'scheduled_tasks.propose', 'plugins.read'
]);

function ipAccessError(code) { const error = new Error(code); error.code = code; return error; }

function buildIpToolPlan(input = {}) {
  const goal = typeof input.goal === 'string' ? input.goal.trim() : '';
  if (goal.length < 3 || goal.length > definition.orchestration.maxGoalCharacters) throw ipAccessError('invalid_ip_goal');
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) throw ipAccessError('ip_scopes_required');
  const scopes = [...new Set(input.scopes.map(item => String(item).trim()))];
  if (scopes.includes('*') || scopes.some(scope => !ALLOWED_SCOPES.has(scope))) throw ipAccessError('ip_scope_not_allowed');
  if (input.explicitConsent !== true) throw ipAccessError('ip_explicit_consent_required');
  return Object.freeze({
    toolPlanId: crypto.randomUUID(), goal, scopes, status: 'proposal',
    explicitConsent: true, executionEnabled: false, toolCallsMade: false,
    deviceControlEnabled: false, shellEnabled: false, filesystemWriteEnabled: false,
    auditRequired: true, stopAvailable: true
  });
}

module.exports = { ALLOWED_SCOPES, buildIpToolPlan, ipAccessError };
