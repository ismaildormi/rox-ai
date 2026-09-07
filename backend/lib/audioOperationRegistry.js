'use strict';

const config = require('../config/audio-system.v1.json');

function audioOperationError(code, operation) {
  const error = new Error(code);
  error.code = code;
  error.operation = operation;
  return error;
}

function normalizeAudioOperation(value) {
  const operation = String(value || '').trim().toLowerCase();
  if (!Object.hasOwn(config.operations, operation)) {
    throw audioOperationError('unknown_audio_operation', operation);
  }
  return operation;
}

function assertAudioOperationAvailable(value) {
  const operation = normalizeAudioOperation(value);
  const definition = config.operations[operation];
  if (definition.status === 'blocked_unpriced') {
    throw audioOperationError('audio_operation_unpriced', operation);
  }
  if (definition.enabledByDefault !== true) {
    throw audioOperationError('audio_operation_disabled', operation);
  }
  return Object.freeze({ operation, ...definition });
}

function providerSupports(provider, operation) {
  const definition = config.providers[provider];
  return Boolean(definition && definition.implementedOperations.includes(normalizeAudioOperation(operation)));
}

function publicInventory() {
  return Object.freeze({
    version: config.version,
    localCapabilities: { ...config.localCapabilities },
    operations: Object.fromEntries(Object.entries(config.operations).map(([key, value]) => [key, {
      enabled: value.enabledByDefault === true,
      status: value.status,
      unitType: value.unitType
    }])),
    requestLimits: { ...config.requestLimits },
    jobs: { ...config.jobs },
    voicePrivacy: { ...config.voicePrivacy }
  });
}

module.exports = { config, normalizeAudioOperation, assertAudioOperationAvailable, providerSupports, publicInventory };
