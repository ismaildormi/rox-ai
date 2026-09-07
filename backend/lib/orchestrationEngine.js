'use strict';

const { definition } = require('./intelligenceRegistry');

function orchestrationError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

function isEnabled(env = process.env) {
  const key = definition.orchestration.environmentVariable;
  return env[key] === 'true' || (env[key] === undefined && definition.orchestration.enabledByDefault === true);
}

function newRun(plan, now = () => new Date()) {
  const timestamp = now().toISOString();
  return {
    version: 'pack-02.task-run.v1',
    idempotencyKey: plan.idempotencyKey,
    state: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    cancelRequested: false,
    steps: Object.fromEntries(plan.steps.map(step => [step.id, {
      state: 'pending', attempts: 0, output: null, errorCode: null
    }]))
  };
}

function validateResume(plan, run) {
  if (!run || run.idempotencyKey !== plan.idempotencyKey || run.version !== 'pack-02.task-run.v1') {
    throw orchestrationError('task_resume_conflict');
  }
  for (const step of plan.steps) {
    if (!run.steps?.[step.id]) throw orchestrationError('task_resume_shape_mismatch', { stepId: step.id });
  }
  return run;
}

function requestCancel(run) {
  if (['succeeded', 'failed', 'cancelled'].includes(run.state)) return run;
  run.cancelRequested = true;
  run.updatedAt = new Date().toISOString();
  return run;
}

async function executePlan(plan, {
  executeStep,
  previousRun = null,
  env = process.env,
  now = () => new Date(),
  deadlineMs = definition.orchestration.maxPlanRuntimeMs
} = {}) {
  if (!isEnabled(env)) throw orchestrationError('task_orchestration_disabled');
  if (typeof executeStep !== 'function') throw orchestrationError('task_executor_required');
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > definition.orchestration.maxPlanRuntimeMs) {
    throw orchestrationError('invalid_task_deadline');
  }
  const run = previousRun ? validateResume(plan, previousRun) : newRun(plan, now);
  if (run.state === 'succeeded') return run;
  const started = now().getTime();
  run.state = 'running';

  for (const stepId of plan.order) {
    const step = plan.steps.find(item => item.id === stepId);
    const state = run.steps[stepId];
    if (state.state === 'succeeded') continue;
    if (run.cancelRequested) {
      run.state = 'cancelled';
      run.updatedAt = now().toISOString();
      return run;
    }
    if (now().getTime() - started > deadlineMs) {
      run.state = 'failed';
      state.state = 'failed';
      state.errorCode = 'task_deadline_exceeded';
      run.updatedAt = now().toISOString();
      return run;
    }
    const dependencyOutputs = Object.fromEntries(step.dependsOn.map(id => [id, run.steps[id].output]));
    while (state.attempts < step.maxAttempts) {
      state.attempts += 1;
      state.state = 'running';
      try {
        state.output = await executeStep(step, dependencyOutputs, { attempt: state.attempts, run });
        state.errorCode = null;
        state.state = 'succeeded';
        break;
      } catch (error) {
        state.errorCode = error?.code || 'task_step_failed';
        state.state = state.attempts >= step.maxAttempts ? 'failed' : 'pending';
      }
    }
    if (state.state !== 'succeeded') {
      run.state = 'failed';
      run.updatedAt = now().toISOString();
      return run;
    }
  }
  run.state = 'succeeded';
  run.updatedAt = now().toISOString();
  return run;
}

module.exports = { isEnabled, newRun, validateResume, requestCancel, executePlan };
