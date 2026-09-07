'use strict';

const config = require('../config/code-studio.v1.json');

function codeStudioError(code, capability) {
  const error = new Error(code);
  error.code = code;
  error.capability = capability;
  return error;
}

function normalizeCapability(value) {
  const capability = String(value || '').trim().toLowerCase();
  if (!Object.hasOwn(config.capabilities, capability)) {
    throw codeStudioError('unknown_code_capability', capability);
  }
  return capability;
}

function assertCodeCapabilityAvailable(value) {
  const capability = normalizeCapability(value);
  const definition = config.capabilities[capability];
  if (definition.enabledByDefault !== true) {
    throw codeStudioError(definition.status || 'code_capability_disabled', capability);
  }
  return Object.freeze({ capability, ...definition });
}

function publicInventory() {
  return Object.freeze({
    version: config.version,
    capabilities: Object.fromEntries(
      Object.entries(config.capabilities).map(([key, value]) => [key, {
        enabled: value.enabledByDefault === true,
        status: value.status,
        requiresSandbox: value.requiresSandbox,
        requiresConfirmation: value.requiresConfirmation
      }])
    ),
    projectLimits: { ...config.projectLimits },
    preview: {
      entryFile: config.preview.entryFile,
      allowedExtensions: [...config.preview.allowedExtensions],
      sandboxTokens: [...config.preview.sandboxTokens],
      networkEnabledByDefault: false
    }
  });
}

module.exports = { config, normalizeCapability, assertCodeCapabilityAvailable, publicInventory };
