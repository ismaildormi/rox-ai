'use strict';

const { config } = require('./workspaceCapabilityRegistry');
const { object, text, fail } = require('./workspaceValidation');

function normalizeWorkflow(input) {
  const value = object(input, 'invalid_workspace_workflow');
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > config.limits.workflowSteps) fail('invalid_workspace_workflow_steps');
  const ids = new Set();
  const steps = value.steps.map((entry, index) => {
    const step = object(entry, 'invalid_workspace_workflow_step');
    const id = text(step.id, { code: 'invalid_workspace_workflow_step_id', max: 64 });
    if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(id) || ids.has(id)) fail('invalid_workspace_workflow_step_id');
    ids.add(id);
    if (!config.workflowCapabilities.includes(step.capability)) fail('invalid_workspace_workflow_capability');
    return {
      id,
      position: index,
      capability: step.capability,
      dependsOn: Array.isArray(step.dependsOn) ? [...step.dependsOn] : [],
      requiresExternalWrite: step.requiresExternalWrite === true,
      executionEnabled: false
    };
  });
  for (const step of steps) {
    if (new Set(step.dependsOn).size !== step.dependsOn.length || step.dependsOn.some(id => !ids.has(id) || id === step.id)) fail('invalid_workspace_workflow_dependency');
    for (const dependency of step.dependsOn) if (steps.find(item => item.id === dependency).position >= step.position) fail('workspace_workflow_dependency_order');
  }
  return {
    name: text(value.name, { code: 'invalid_workspace_workflow_name', max: config.limits.nameChars }),
    description: text(value.description, { code: 'invalid_workspace_workflow_description', max: config.limits.descriptionChars, optional: true }),
    steps,
    executionEnabled: false,
    externalWritesEnabled: false
  };
}

module.exports = { normalizeWorkflow };
