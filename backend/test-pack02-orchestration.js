'use strict';

const assert = require('node:assert/strict');
const { createPlan } = require('./lib/taskPlanner');
const { executePlan, newRun, requestCancel } = require('./lib/orchestrationEngine');

async function main() {
  const plan = createPlan({
    idempotencyKey: 'run-orchestration-01',
    intent: 'Generate an answer then review it',
    steps: [
      { id: 'answer', capability: 'chat', maxAttempts: 2 },
      { id: 'review', capability: 'code', dependsOn: ['answer'], maxAttempts: 1 }
    ]
  });

  let calls = 0;
  await assert.rejects(executePlan(plan, { executeStep: async () => 'x', env: {} }),
    error => error.code === 'task_orchestration_disabled');
  assert.equal(calls, 0);

  const run = await executePlan(plan, {
    env: { ZUVYR_TASK_ORCHESTRATION_ENABLED: 'true' },
    executeStep: async (step, dependencies, context) => {
      calls++;
      if (step.id === 'answer' && context.attempt === 1) {
        const error = new Error('temporary'); error.code = 'temporary_failure'; throw error;
      }
      if (step.id === 'review') assert.equal(dependencies.answer, 'answer-output');
      return `${step.id}-output`;
    }
  });
  assert.equal(run.state, 'succeeded');
  assert.equal(run.steps.answer.attempts, 2);
  assert.equal(run.steps.review.attempts, 1);
  assert.equal(calls, 3);

  const beforeResumeCalls = calls;
  const replay = await executePlan(plan, {
    previousRun: run,
    env: { ZUVYR_TASK_ORCHESTRATION_ENABLED: 'true' },
    executeStep: async () => { calls++; return 'unexpected'; }
  });
  assert.equal(replay.state, 'succeeded');
  assert.equal(calls, beforeResumeCalls);

  const cancelled = requestCancel(newRun(plan));
  const cancelResult = await executePlan(plan, {
    previousRun: cancelled,
    env: { ZUVYR_TASK_ORCHESTRATION_ENABLED: 'true' },
    executeStep: async () => 'unexpected'
  });
  assert.equal(cancelResult.state, 'cancelled');

  const failingPlan = createPlan({ idempotencyKey: 'run-orchestration-02', intent: 'fail safely', steps: [
    { id: 'only', capability: 'chat', maxAttempts: 2 }
  ] });
  const failed = await executePlan(failingPlan, {
    env: { ZUVYR_TASK_ORCHESTRATION_ENABLED: 'true' },
    executeStep: async () => { const error = new Error('no'); error.code = 'provider_unavailable'; throw error; }
  });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.steps.only.attempts, 2);
  assert.equal(failed.steps.only.errorCode, 'provider_unavailable');

  console.log('PASS: Pack 02 orchestration disabled gate, handoff, retry, resume, cancel and failure');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
