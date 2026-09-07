'use strict';
const assert = require('node:assert/strict');
const { normalizeWorkflow } = require('./lib/workspaceWorkflowContract');
const { normalizeSchedule } = require('./lib/workspaceScheduleContract');
const workflowId = '33333333-3333-4333-8333-333333333333';
const workflow = normalizeWorkflow({ name: 'Creator launch', steps: [
  { id: 'research', capability: 'research' },
  { id: 'document', capability: 'document', dependsOn: ['research'] },
  { id: 'export', capability: 'export', dependsOn: ['document'], requiresExternalWrite: true }
] });
assert.equal(workflow.executionEnabled, false);
assert.equal(workflow.externalWritesEnabled, false);
assert.deepEqual(workflow.steps.map(step => step.position), [0,1,2]);
assert.throws(() => normalizeWorkflow({ name: 'cycle', steps: [{ id: 'later', capability: 'chat', dependsOn: ['next'] }, { id: 'next', capability: 'document' }] }), /dependency_order/);
const schedule = normalizeSchedule({ workflowId, title: 'Weekly report', type: 'recurring', runAt: '2026-01-02T00:00:00.000Z', intervalMinutes: 10080, timezone: 'UTC', notificationsEnabled: true }, { now: Date.parse('2026-01-01T00:00:00.000Z') });
assert.equal(schedule.executionEnabled, false);
assert.equal(schedule.state, 'draft');
assert.throws(() => normalizeSchedule({ workflowId, title: 'Too fast', type: 'recurring', runAt: '2026-01-02T00:00:00.000Z', intervalMinutes: 5, timezone: 'UTC' }, { now: Date.parse('2026-01-01T00:00:00.000Z') }), /invalid_workspace_schedule_interval/);
console.log('PASS: Pack 09 ordered Workflow and bounded draft Schedule contracts with execution disabled');
