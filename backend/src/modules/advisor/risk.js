// ROX AI — src/modules/advisor/risk.js
//
// Deterministic, auditable risk detection — each risk is a named rule
// against a threshold in config/advisor.json, not a model's guess. An
// admin can see exactly which rule fired and why. Detecting fraud/abuse
// "for real" (device fingerprints, velocity graphs) is a much larger,
// separate project — this operates on signals ROX AI already has:
// credit_audit_log volume/failure rate per user, system_alerts, and
// margin data. It's the honest v1: a rule engine over existing data,
// built so a smarter detector can slot into the same `risks` array
// shape later without changing what reads it.

const { advisor: config } = require('../../core/config');
const { supabaseAdmin } = require('../../../lib/supabaseAdmin');

function risk(type, severity, message, metadata = {}) {
  return { type, severity, message, metadata };
}

async function detectAbuseAndSuspiciousAccounts() {
  const thresholds = config.riskThresholds.abuse;
  const since = new Date(Date.now() - 24 * 3600000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('credit_audit_log')
    .select('user_id, status, feature')
    .gte('created_at', since);

  if (error || !data) return [];

  const byUser = data.reduce((acc, row) => {
    acc[row.user_id] = acc[row.user_id] || { total: 0, errors: 0, blocked: 0 };
    acc[row.user_id].total += 1;
    if (row.status === 'error') acc[row.user_id].errors += 1;
    if (row.status === 'blocked') acc[row.user_id].blocked += 1;
    return acc;
  }, {});

  const risks = [];
  for (const [userId, stats] of Object.entries(byUser)) {
    if (stats.total >= thresholds.highVolumeRequestsPerDay) {
      risks.push(risk('expensive_user', 'warning', `User ${userId} made ${stats.total} requests in 24h — review for expected usage vs abuse.`, { userId, ...stats }));
    }
    if (stats.blocked >= thresholds.repeatedBlocksSuspicious) {
      risks.push(risk('suspicious_account', 'warning', `User ${userId} was blocked ${stats.blocked} times in 24h.`, { userId, ...stats }));
    }
  }
  return risks;
}

function detectFinancialRisks(snapshot) {
  const thresholds = config.riskThresholds.financial;
  const risks = [];
  const t = snapshot.today || {};
  const revenue = Number(t.revenue_usd || 0);
  const aiCost = Number(t.ai_cost_usd || 0);
  const marginPct = revenue > 0 ? (revenue - aiCost) / revenue : (aiCost > 0 ? -1 : 0);

  if (marginPct < thresholds.lowMarginPct) {
    risks.push(risk('low_profit_margin', 'critical', `Profit margin is ${(marginPct * 100).toFixed(1)}%, below the ${(thresholds.lowMarginPct * 100).toFixed(0)}% floor.`, { marginPct }));
  }
  if (aiCost > thresholds.highDailyAiCostUsd) {
    risks.push(risk('high_operating_costs', 'warning', `AI costs reached $${aiCost.toFixed(2)} today, above the $${thresholds.highDailyAiCostUsd} threshold.`, { aiCost }));
  }
  for (const combo of snapshot.margin24h || []) {
    if (Number(combo.margin_usd) < thresholds.negativeComboFloorUsd) {
      risks.push(risk('billing_anomaly', 'critical', `${combo.feature}/${combo.model_used} is net-negative ($${combo.margin_usd}) over the last 24h.`, combo));
    }
  }
  return risks;
}

function detectInfrastructureRisks(snapshot) {
  const thresholds = config.riskThresholds.infrastructure;
  const risks = [];
  const trippedModels = (snapshot.modelHealth || []).filter((m) => m.state === 'open');
  if (trippedModels.length > 0) {
    risks.push(risk('provider_outage', 'critical', `${trippedModels.length} model(s) currently unavailable: ${trippedModels.map((m) => m.model).join(', ')}.`, { models: trippedModels.map((m) => m.model) }));
  }
  const imgFailRate = snapshot.imageJobs24h.total ? snapshot.imageJobs24h.failed / snapshot.imageJobs24h.total : 0;
  const vidFailRate = snapshot.videoJobs24h.total ? snapshot.videoJobs24h.failed / snapshot.videoJobs24h.total : 0;
  if (imgFailRate > thresholds.highJobFailureRate) risks.push(risk('server_overload', 'warning', `Image job failure rate is ${(imgFailRate * 100).toFixed(0)}%.`, { imgFailRate }));
  if (vidFailRate > thresholds.highJobFailureRate) risks.push(risk('server_overload', 'warning', `Video job failure rate is ${(vidFailRate * 100).toFixed(0)}%.`, { vidFailRate }));
  return risks;
}

function detectAlertBackedRisks(snapshot) {
  // Fraud attempts / refund-failure signals already flow into
  // system_alerts from existing hardened code (gatekeeper.js,
  // 08_maintenance.sql) — surface the unacknowledged ones here rather
  // than duplicating detection logic.
  return (snapshot.openAlerts || []).map((a) =>
    risk(
      a.alert_type === 'refund_failed' ? 'fraud_attempt_or_billing_error' : 'database_bottleneck_or_mismatch',
      a.severity,
      a.message,
      a.metadata
    )
  );
}

async function detectRisks(snapshot) {
  const [abuse] = await Promise.all([detectAbuseAndSuspiciousAccounts()]);
  return [
    ...detectFinancialRisks(snapshot),
    ...detectInfrastructureRisks(snapshot),
    ...detectAlertBackedRisks(snapshot),
    ...abuse,
  ];
}

module.exports = { detectRisks };
