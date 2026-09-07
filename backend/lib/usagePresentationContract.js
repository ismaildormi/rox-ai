'use strict';

function error(code) { const value = new Error(code); value.code = code; throw value; }
function integer(value, code, nullable = false) {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) error(code);
  return value;
}
function timestamp(value, code, nullable = false) {
  if (nullable && value === null) return null;
  const parsed = new Date(value);
  if (typeof value !== 'string' || !Number.isFinite(parsed.getTime())) error(code);
  return parsed.toISOString();
}
function windowContract(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) error(`invalid_${label}_window`);
  const total = integer(value.total, `invalid_${label}_total`, true);
  const used = integer(value.used, `invalid_${label}_used`);
  if (total !== null && used > total) error(`invalid_${label}_usage`);
  return {
    total,
    used,
    remaining: total === null ? null : total - used,
    progressPercent: total === null || total === 0 ? null : Math.min(100, Math.floor(used * 100 / total)),
    startsAt: timestamp(value.startsAt, `invalid_${label}_start`, true),
    endsAt: timestamp(value.endsAt, `invalid_${label}_end`, true),
    configured: total !== null
  };
}
function normalizeUsagePresentation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) error('invalid_usage_presentation');
  const topupBalance = integer(input.topupBalance, 'invalid_topup_balance');
  return {
    plan: typeof input.plan === 'string' && input.plan.trim() ? input.plan.trim().toLowerCase() : error('invalid_usage_plan'),
    fiveHour: windowContract(input.fiveHour, 'five_hour'),
    weekly: windowContract(input.weekly, 'weekly'),
    topup: { balance: topupBalance, persistent: true, silentlyConsumed: false },
    topupChoiceRequired: input.topupChoiceRequired === true,
    autoReloadEnabled: false
  };
}
module.exports = { normalizeUsagePresentation };
