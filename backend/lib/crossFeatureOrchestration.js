'use strict';

const crypto = require('node:crypto');
const definition = require('../config/unified-product.v1.json');

const OUTPUTS = new Set(['images', 'video', 'audio', 'code', 'research', 'documents', 'spreadsheets', 'presentations', 'project']);

function orchestrationError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

function cleanGoal(value) {
  const goal = typeof value === 'string' ? value.trim() : '';
  if (goal.length < 3 || goal.length > definition.orchestration.maxGoalCharacters) {
    throw orchestrationError('invalid_orchestration_goal');
  }
  return goal;
}

function cleanOutputs(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > definition.orchestration.maxOutputs) {
    throw orchestrationError('invalid_requested_outputs');
  }
  const outputs = [...new Set(value.map(item => String(item).trim().toLowerCase()))];
  if (outputs.some(item => !OUTPUTS.has(item))) throw orchestrationError('unknown_requested_output');
  return outputs;
}

function step(id, capability, title, dependsOn = []) {
  return Object.freeze({ id, capability, title, dependsOn, status: 'proposed', executionEnabled: false });
}

function buildCrossFeaturePlan(input = {}) {
  const goal = cleanGoal(input.goal);
  const requestedOutputs = cleanOutputs(input.requestedOutputs);
  const mediaRequested = requestedOutputs.some(item => ['images', 'video', 'audio'].includes(item));
  if (mediaRequested && input.additionalCreationConsent !== true) {
    throw orchestrationError('additional_creation_consent_required', { requestedOutputs });
  }

  const steps = [];
  const add = (capability, title, dependsOn = []) => {
    const id = `step_${String(steps.length + 1).padStart(2, '0')}_${capability}`;
    steps.push(step(id, capability, title, dependsOn));
    return id;
  };

  let researchId = null;
  if (requestedOutputs.includes('research') || requestedOutputs.includes('code')) {
    researchId = add('research', 'Validate requirements, audience and sources');
  }
  const assetIds = [];
  if (requestedOutputs.includes('images')) assetIds.push(add('images', 'Create approved image assets', researchId ? [researchId] : []));
  if (requestedOutputs.includes('video')) assetIds.push(add('video', 'Create approved video assets', researchId ? [researchId] : []));
  if (requestedOutputs.includes('audio')) assetIds.push(add('audio', 'Create approved audio assets', researchId ? [researchId] : []));
  let codeId = null;
  if (requestedOutputs.includes('code')) codeId = add('code', 'Build and integrate the approved experience', [researchId, ...assetIds].filter(Boolean));
  if (requestedOutputs.includes('documents')) add('documents', 'Create the project document', [codeId || researchId].filter(Boolean));
  if (requestedOutputs.includes('spreadsheets')) add('spreadsheets', 'Create the validated workbook', [researchId].filter(Boolean));
  if (requestedOutputs.includes('presentations')) add('presentations', 'Create the presentation', [researchId, ...assetIds].filter(Boolean));
  if (requestedOutputs.includes('project')) add('projects', 'Collect approved outputs in one project', steps.map(item => item.id));

  return Object.freeze({
    planId: crypto.randomUUID(),
    version: definition.version,
    goal,
    requestedOutputs,
    additionalCreationConsent: input.additionalCreationConsent === true,
    status: 'proposal',
    steps,
    executionEnabled: false,
    providerCallsMade: false,
    creditsReserved: false,
    creditReservationRequired: true,
    approvalRequired: true
  });
}

function approveCrossFeaturePlan(input = {}) {
  if (!input.plan || input.approved !== true || input.confirmCreditReservation !== true) {
    throw orchestrationError('explicit_plan_and_credit_approval_required');
  }
  const plan = buildCrossFeaturePlan({
    goal: input.plan.goal,
    requestedOutputs: input.plan.requestedOutputs,
    additionalCreationConsent: input.plan.additionalCreationConsent
  });
  return Object.freeze({
    plan: { ...plan, planId: input.plan.planId || plan.planId },
    approved: true,
    executionEnabled: false,
    providerCallsMade: false,
    creditsReserved: false,
    code: 'execution_blocked_until_pricing_providers_and_settlement_are_verified'
  });
}

module.exports = { OUTPUTS, buildCrossFeaturePlan, approveCrossFeaturePlan, orchestrationError };
