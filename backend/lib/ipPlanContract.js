'use strict';

const crypto = require('node:crypto');
const { config, ipError } = require('./ipCapabilityRegistry');
const { normalizeIpAction } = require('./ipActionPolicy');

function normalizeIpPlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw ipError('invalid_ip_plan');
  const goal = String(value.goal || '').trim();
  if (!goal || goal.length > 2000) throw ipError('invalid_ip_plan_goal');
  if (!Array.isArray(value.actions) || value.actions.length < 1 || value.actions.length > config.execution.maxPlanActions) throw ipError('invalid_ip_plan_actions');
  const actions = value.actions.map(normalizeIpAction);
  const ids = new Set();
  for (const action of actions) { if (ids.has(action.id)) throw ipError('duplicate_ip_action_id'); ids.add(action.id); }
  const scopes = [...new Set(actions.map(action => action.scope))];
  const confirmationActionIds = actions.filter(action => action.requiresConfirmation).map(action => action.id);
  return Object.freeze({ id: value.id || crypto.randomUUID(), goal, actions: Object.freeze(actions), requiredScopes: Object.freeze(scopes), confirmationActionIds: Object.freeze(confirmationActionIds), executable: false });
}

module.exports = { normalizeIpPlan };
