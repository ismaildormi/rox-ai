'use strict';

const { config, normalizeCapability } = require('./codeStudioRegistry');

function runtimeError(code, operation) {
  const error = new Error(code);
  error.code = code;
  error.operation = operation;
  return error;
}

function assertRuntimeRequestAllowed(value = {}) {
  const operation = normalizeCapability(value.operation);
  const definition = config.capabilities[operation];
  if (!['terminal', 'run', 'dependencies', 'build', 'test', 'deploy'].includes(operation)) {
    throw runtimeError('not_a_runtime_operation', operation);
  }
  if (definition.enabledByDefault !== true || config.runtime.executorConfigured !== true) {
    throw runtimeError(definition.status || 'code_runtime_disabled', operation);
  }
  if (definition.requiresConfirmation && value.confirmed !== true) throw runtimeError('code_runtime_confirmation_required', operation);
  if (definition.requiresSandbox && value.sandboxReady !== true) throw runtimeError('code_runtime_sandbox_required', operation);
  throw runtimeError('code_runtime_executor_unavailable', operation);
}

function runtimeStatus() {
  return Object.freeze({
    executorConfigured: false,
    networkEnabled: false,
    secretsMounted: false,
    allowedOperations: []
  });
}

module.exports = { assertRuntimeRequestAllowed, runtimeStatus };
