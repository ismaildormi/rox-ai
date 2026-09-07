'use strict';

const definition = require('../config/intelligence-core.v1.json');
const { findCostEntry, resolveCostEntry } = require('./costRegistry');

const ALLOWED_PROVIDER_STATES = new Set([
  'conditional',
  'registered_unverified'
]);
const ALLOWED_MODEL_STATES = new Set([
  'conditional',
  'blocked_unverified_price',
  'disabled'
]);

function intelligenceError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

function validateDefinition(value = definition) {
  if (!value || typeof value.version !== 'string') {
    throw intelligenceError('invalid_intelligence_registry_version');
  }
  if (!Array.isArray(value.providers) || !Array.isArray(value.models) || !value.routes) {
    throw intelligenceError('invalid_intelligence_registry');
  }

  const providers = new Set();
  for (const provider of value.providers) {
    if (!provider.id || providers.has(provider.id)) {
      throw intelligenceError('duplicate_or_invalid_provider', { provider: provider.id || null });
    }
    if (!ALLOWED_PROVIDER_STATES.has(provider.status)) {
      throw intelligenceError('invalid_provider_status', { provider: provider.id });
    }
    providers.add(provider.id);
  }

  const models = new Map();
  for (const model of value.models) {
    if (!model.id || models.has(model.id) || !providers.has(model.provider)) {
      throw intelligenceError('duplicate_or_invalid_model', { model: model.id || null });
    }
    if (!ALLOWED_MODEL_STATES.has(model.status) || !Array.isArray(model.capabilities) || model.capabilities.length === 0) {
      throw intelligenceError('invalid_model_definition', { model: model.id });
    }
    models.set(model.id, model);
  }

  for (const [capability, route] of Object.entries(value.routes)) {
    if (!Array.isArray(route) || route.length === 0 || new Set(route).size !== route.length) {
      throw intelligenceError('invalid_route', { capability });
    }
    for (const modelId of route) {
      const model = models.get(modelId);
      if (!model || !model.capabilities.includes(capability)) {
        throw intelligenceError('invalid_route_model', { capability, modelId });
      }
    }
  }
  return value;
}

function isEnforcementEnabled(env = process.env) {
  return env[definition.enforcement.environmentVariable] === 'true' ||
    (env[definition.enforcement.environmentVariable] === undefined && definition.enforcement.enabledByDefault === true);
}

function getModel(modelId, value = definition) {
  validateDefinition(value);
  return value.models.find(model => model.id === modelId) || null;
}

function findModelByRoute(provider, model, capability, value = definition) {
  validateDefinition(value);
  return value.models.find(item => item.provider === provider && item.model === model && item.capabilities.includes(capability)) || null;
}

function assertRouteAllowed({ provider, model, capability, operationType = 'text_generation' }, { env = process.env } = {}) {
  const entry = findModelByRoute(provider, model, capability);
  if (!entry) throw intelligenceError('unknown_intelligence_route', { provider, model, capability });
  if (entry.status === 'blocked_unverified_price' || entry.status === 'disabled') {
    throw intelligenceError('intelligence_route_blocked', { modelId: entry.id, status: entry.status });
  }
  if (entry.requiredEnvironment && env[entry.requiredEnvironment.name] !== entry.requiredEnvironment.value) {
    throw intelligenceError('intelligence_route_condition_not_met', { modelId: entry.id });
  }

  const cost = findCostEntry({ provider, modelToolId: model, capability, operationType });
  if (!cost) throw intelligenceError('intelligence_route_missing_cost', { modelId: entry.id });
  resolveCostEntry({ provider, modelToolId: model, capability, operationType }, { env });
  return Object.freeze({ ...entry });
}

function resolveRoute(capability, { env = process.env, includeBlocked = false } = {}) {
  validateDefinition();
  const route = definition.routes[capability];
  if (!route) throw intelligenceError('unknown_intelligence_capability', { capability });
  return route.map(id => getModel(id)).filter(model => {
    if (includeBlocked) return true;
    try {
      assertRouteAllowed({ provider: model.provider, model: model.model, capability }, { env });
      return true;
    } catch (_) {
      return false;
    }
  }).map(model => Object.freeze({ provider: model.provider, model: model.model, registryId: model.id }));
}

function inventory() {
  validateDefinition();
  return Object.freeze({
    version: definition.version,
    providers: definition.providers.map(item => Object.freeze({ ...item })),
    models: definition.models.map(item => Object.freeze({ ...item })),
    routes: Object.fromEntries(Object.entries(definition.routes).map(([key, ids]) => [key, [...ids]]))
  });
}

module.exports = {
  definition,
  validateDefinition,
  isEnforcementEnabled,
  getModel,
  findModelByRoute,
  assertRouteAllowed,
  resolveRoute,
  inventory
};
