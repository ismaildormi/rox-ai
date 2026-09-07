'use strict';

const { definition } = require('./intelligenceRegistry');

const STEP_ID = /^[a-z][a-z0-9_-]{0,63}$/;

function plannerError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

function normalizeStep(step, index) {
  if (!step || !STEP_ID.test(step.id || '')) throw plannerError('invalid_task_step_id', { index });
  if (typeof step.capability !== 'string' || !definition.routes[step.capability]) {
    throw plannerError('unknown_task_capability', { stepId: step.id });
  }
  const dependsOn = step.dependsOn === undefined ? [] : step.dependsOn;
  if (!Array.isArray(dependsOn) || new Set(dependsOn).size !== dependsOn.length || dependsOn.includes(step.id)) {
    throw plannerError('invalid_task_dependencies', { stepId: step.id });
  }
  return Object.freeze({
    id: step.id,
    capability: step.capability,
    dependsOn: Object.freeze([...dependsOn]),
    input: step.input === undefined ? null : step.input,
    maxAttempts: step.maxAttempts === undefined ? definition.orchestration.maxAttemptsPerStep : step.maxAttempts
  });
}

function topologicalOrder(steps) {
  const byId = new Map(steps.map(step => [step.id, step]));
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!byId.has(dependency)) throw plannerError('unknown_task_dependency', { stepId: step.id, dependency });
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];
  function visit(id) {
    if (visiting.has(id)) throw plannerError('task_dependency_cycle', { stepId: id });
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    ordered.push(id);
  }
  for (const step of steps) visit(step.id);
  return ordered;
}

function createPlan({ idempotencyKey, intent, steps } = {}) {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8 || idempotencyKey.length > 128) {
    throw plannerError('invalid_task_idempotency_key');
  }
  if (typeof intent !== 'string' || !intent.trim() || intent.length > 500) throw plannerError('invalid_task_intent');
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > definition.orchestration.maxSteps) {
    throw plannerError('invalid_task_step_count');
  }
  const normalized = steps.map(normalizeStep);
  if (new Set(normalized.map(step => step.id)).size !== normalized.length) throw plannerError('duplicate_task_step_id');
  for (const step of normalized) {
    if (!Number.isSafeInteger(step.maxAttempts) || step.maxAttempts < 1 || step.maxAttempts > definition.orchestration.maxAttemptsPerStep) {
      throw plannerError('invalid_task_max_attempts', { stepId: step.id });
    }
  }
  const order = topologicalOrder(normalized);
  return Object.freeze({
    version: 'pack-02.task-plan.v1',
    idempotencyKey: idempotencyKey.trim(),
    intent: intent.trim(),
    steps: Object.freeze(normalized),
    order: Object.freeze(order)
  });
}

module.exports = { createPlan, topologicalOrder };
