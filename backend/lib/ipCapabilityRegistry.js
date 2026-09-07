'use strict';

const config = require('../config/ip-system.v1.json');

function ipError(code, detail) { const error = new Error(code); error.code = code; if (detail !== undefined) error.detail = detail; return error; }

function normalizeIpActionType(value) {
  const actionType = String(value || '').trim().toLowerCase();
  if (!Object.hasOwn(config.actions, actionType)) throw ipError('unknown_ip_action', actionType);
  return actionType;
}

function assertIpExecutionAvailable() {
  if (config.execution.enabledByDefault !== true || config.execution.sandboxConfigured !== true) {
    throw ipError('roxip_execution_disabled');
  }
  return true;
}

function publicInventory() {
  return Object.freeze({
    version: config.version,
    execution: { enabled: false, status: config.execution.status, sandboxConfigured: false, networkEnabledByDefault: false, secretsAvailableToAgent: false },
    capabilities: Object.fromEntries(Object.entries(config.capabilities).map(([key, value]) => [key, { enabled: value.enabledByDefault === true, status: value.status }])),
    permissionScopes: Object.fromEntries(Object.entries(config.permissionScopes).map(([key, value]) => [key, { risk: value.risk, maxGrantSeconds: value.maxGrantSeconds }])),
    actions: Object.fromEntries(Object.entries(config.actions).map(([key, value]) => [key, { scope: value.scope, risk: value.risk, requiresConfirmation: value.requiresConfirmation, reversible: value.reversible }]))
  });
}

module.exports = { config, ipError, normalizeIpActionType, assertIpExecutionAvailable, publicInventory };
