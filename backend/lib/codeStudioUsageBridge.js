'use strict';

const CODE_USAGE_KINDS = Object.freeze([
  'ai_code_edit',
  'build_job',
  'sandbox_runtime',
  'preview_runtime',
  'preview_egress',
  'idle_session'
]);

const KIND_SET = new Set(CODE_USAGE_KINDS);

const RUNTIME_OPERATION_USAGE_KIND = Object.freeze({
  build: 'build_job',
  run: 'sandbox_runtime',
  terminal: 'sandbox_runtime',
  dependencies: 'sandbox_runtime',
  test: 'sandbox_runtime'
});

function bridgeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requiredText(value, code, max) {
  const text = String(value || '').trim();
  if (!text || text.length > max) throw bridgeError(code);
  return text;
}

function optionalText(value, max, code) {
  if (value === null || value === undefined || value === '') return null;
  return requiredText(value, code, max);
}

function usageKindForOperation(operation) {
  const normalized = String(operation || '').trim().toLowerCase();
  const kind = RUNTIME_OPERATION_USAGE_KIND[normalized];
  if (!kind) throw bridgeError('unmetered_code_runtime_operation');
  return kind;
}

function normalizeUsageKind(value) {
  const kind = String(value || '').trim().toLowerCase();
  if (!KIND_SET.has(kind)) throw bridgeError('invalid_code_usage_kind');
  return kind;
}

function createCodeStudioUsageBridge(creditApi = {}) {
  const reserveCredits = creditApi && creditApi.reserveCredits;
  const settleCredits = creditApi && creditApi.settleCredits;
  const refundCredits = creditApi && creditApi.refundCredits;

  async function reserveUsage({
    userId,
    requestId,
    projectId = null,
    taskId = null,
    stepId = 'root',
    usageKind,
    operation = null,
    creditsConsumed,
    modelUsed = 'code-studio',
    pricingVersion = null
  } = {}) {
    if (typeof reserveCredits !== 'function') throw bridgeError('code_usage_reserve_unavailable');
    const normalizedUserId = requiredText(userId, 'code_usage_user_required', 200);
    const normalizedRequestId = requiredText(requestId, 'code_usage_request_required', 200);
    const normalizedKind = normalizeUsageKind(usageKind || usageKindForOperation(operation));

    if (!Number.isSafeInteger(creditsConsumed) || creditsConsumed < 1) {
      throw bridgeError('invalid_code_usage_reserved_credits');
    }

    return reserveCredits({
      userId: normalizedUserId,
      requestId: normalizedRequestId,
      feature: 'code',
      modelUsed: requiredText(modelUsed, 'invalid_code_usage_model', 200),
      creditsConsumed,
      projectId: optionalText(projectId, 200, 'invalid_code_usage_project_id'),
      taskId: optionalText(taskId, 200, 'invalid_code_usage_task_id') || normalizedRequestId,
      stepId: requiredText(stepId, 'invalid_code_usage_step_id', 128),
      usageKind: normalizedKind,
      pricingVersion: optionalText(pricingVersion, 200, 'invalid_code_usage_pricing_version')
    });
  }

  async function settleUsage(requestId, finalCredits) {
    if (typeof settleCredits !== 'function') throw bridgeError('code_usage_settle_unavailable');
    const normalizedRequestId = requiredText(requestId, 'code_usage_request_required', 200);
    if (!Number.isSafeInteger(finalCredits) || finalCredits < 0) {
      throw bridgeError('invalid_code_usage_final_credits');
    }
    return settleCredits(normalizedRequestId, finalCredits);
  }

  async function refundUsage(requestId) {
    if (typeof refundCredits !== 'function') throw bridgeError('code_usage_refund_unavailable');
    return refundCredits(requiredText(requestId, 'code_usage_request_required', 200));
  }

  function status() {
    return Object.freeze({
      reserve: typeof reserveCredits === 'function',
      settle: typeof settleCredits === 'function',
      refund: typeof refundCredits === 'function',
      usageKinds: [...CODE_USAGE_KINDS]
    });
  }

  return Object.freeze({
    reserveUsage,
    settleUsage,
    refundUsage,
    usageKindForOperation,
    normalizeUsageKind,
    status
  });
}

module.exports = {
  CODE_USAGE_KINDS,
  RUNTIME_OPERATION_USAGE_KIND,
  usageKindForOperation,
  normalizeUsageKind,
  createCodeStudioUsageBridge
};
