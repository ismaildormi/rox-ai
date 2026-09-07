'use strict';

const config = require('../config/video-system.v1.json');

function videoOperationError(code, operation) {
  const error = new Error(code);
  error.code = code;
  error.operation = operation;
  return error;
}

function normalizeVideoOperation(value) {
  const operation = String(value || 'text_to_video').trim().toLowerCase();
  if (!Object.hasOwn(config.operations, operation)) {
    throw videoOperationError('unknown_video_operation', operation);
  }
  return operation;
}

function assertVideoOperationAvailable(value) {
  const operation = normalizeVideoOperation(value);
  const definition = config.operations[operation];
  if (definition.status === 'blocked_unpriced') {
    throw videoOperationError('video_operation_unpriced', operation);
  }
  if (definition.enabledByDefault !== true) {
    throw videoOperationError('video_operation_disabled', operation);
  }
  return Object.freeze({ operation, ...definition });
}

function assertVideoRequestAvailable(request) {
  return assertVideoOperationAvailable(request?.operation);
}

function providerSupports(provider, operation) {
  const definition = config.providers[provider];
  return Boolean(
    definition &&
    definition.implementedOperations.includes(normalizeVideoOperation(operation))
  );
}

function inventory() {
  return Object.freeze({
    version: config.version,
    operations: { ...config.operations },
    providers: { ...config.providers },
    jobs: { ...config.jobs }
  });
}

module.exports = {
  config,
  normalizeVideoOperation,
  assertVideoOperationAvailable,
  assertVideoRequestAvailable,
  providerSupports,
  inventory
};
