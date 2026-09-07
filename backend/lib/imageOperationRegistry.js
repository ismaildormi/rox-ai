'use strict';

const config = require('../config/image-system.v1.json');

function imageOperationError(code, operation) {
  const error = new Error(code);
  error.code = code;
  error.operation = operation;
  return error;
}

function normalizeImageOperation(value) {
  const operation = String(value || 'generate').trim().toLowerCase();
  if (!Object.hasOwn(config.operations, operation)) throw imageOperationError('unknown_image_operation', operation);
  return operation;
}

function assertImageOperationAvailable(value) {
  const operation = normalizeImageOperation(value);
  const definition = config.operations[operation];
  if (definition.status === 'blocked_unpriced') throw imageOperationError('image_operation_unpriced', operation);
  if (definition.enabledByDefault !== true) throw imageOperationError('image_operation_disabled', operation);
  return Object.freeze({ operation, ...definition });
}

function assertImageRequestAvailable(request) {
  const definition = assertImageOperationAvailable(request?.operation);
  const options = request?.options || {};
  const hasUnsupportedGenerateInput =
    (request?.referenceAssetIds || []).length > 0 ||
    Boolean(request?.sourceAssetId) ||
    Boolean(request?.maskAssetId) ||
    options.ratio !== '1:1' ||
    options.resolution !== '1024' ||
    options.quantity !== 1 ||
    Boolean(options.style) ||
    options.seed !== null;

  // The current FAL/Replicate adapters only implement prompt -> one image.
  // Refuse options that those adapters would silently ignore. Their contracts
  // remain registered for the later, separately priced activation milestone.
  if (definition.operation === 'generate' && hasUnsupportedGenerateInput) {
    throw imageOperationError(
      'image_generation_configuration_unavailable',
      definition.operation
    );
  }

  return definition;
}

function providerSupports(provider, operation) {
  const item = config.providers[provider];
  return Boolean(item && item.implementedOperations.includes(normalizeImageOperation(operation)));
}

function inventory() {
  return Object.freeze({ version: config.version, operations: { ...config.operations }, providers: { ...config.providers } });
}

module.exports = {
  config,
  normalizeImageOperation,
  assertImageOperationAvailable,
  assertImageRequestAvailable,
  providerSupports,
  inventory
};
