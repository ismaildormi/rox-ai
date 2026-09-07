'use strict';

const assert = require('node:assert/strict');
const { createPlan } = require('./lib/taskPlanner');

const plan = createPlan({
  idempotencyKey: 'task-00000001',
  intent: 'Answer and then review code',
  steps: [
    { id: 'review', capability: 'code', dependsOn: ['answer'], input: { file: 'safe.js' } },
    { id: 'answer', capability: 'chat', input: { prompt: 'hello' } }
  ]
});

assert.deepEqual(plan.order, ['answer', 'review']);
assert.equal(plan.steps[0].maxAttempts, 3);
assert.throws(() => createPlan({ idempotencyKey: 'short', intent: 'x', steps: [{ id: 'a', capability: 'chat' }] }),
  error => error.code === 'invalid_task_idempotency_key');
assert.throws(() => createPlan({ idempotencyKey: 'task-00000002', intent: 'x', steps: [
  { id: 'a', capability: 'chat', dependsOn: ['b'] },
  { id: 'b', capability: 'chat', dependsOn: ['a'] }
] }), error => error.code === 'task_dependency_cycle');
assert.throws(() => createPlan({ idempotencyKey: 'task-00000003', intent: 'x', steps: [
  { id: 'a', capability: 'image' }
] }), error => error.code === 'unknown_task_capability');
assert.throws(() => createPlan({ idempotencyKey: 'task-00000004', intent: 'x', steps: [
  { id: 'a', capability: 'chat', dependsOn: ['missing'] }
] }), error => error.code === 'unknown_task_dependency');

console.log('PASS: Pack 02 deterministic planner, dependency order, limits and cycle rejection');
