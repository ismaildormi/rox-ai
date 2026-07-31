// ROX AI — src/modules/advisor (orchestrator)
//
// Ties collect.js (gather) -> health.js/risk.js/forecast.js (analyze) ->
// insights.js (explain) together into one daily report, persists it to
// advisor_daily_reports + advisor_recommendations (13_advisor_optimizer_schema.sql),
// and exposes the read/resolve functions the admin routes call.
//
// runDailyAnalysis() is meant to be called by exactly two callers:
//   1. POST /internal/advisor/run-daily (cron secret) — the scheduled,
//      once-a-day run (mirrors /internal/maintenance/run's pattern).
//   2. POST /api/v1/admin/advisor/report/run (admin, requireAdmin) — an
//      on-demand "run it now" for testing/demoing without waiting for
//      the schedule. Same function, same output shape, either way.

const { supabaseAdmin } = require('../../../lib/supabaseAdmin');
const { collectSnapshot } = require('./collect');
const { computeHealthScores } = require('./health');
const { detectRisks } = require('./risk');
const { computeForecast } = require('./forecast');
const { buildInsights, buildOpportunities, buildRecommendations } = require('./insights');

/**
 * Confidence adjustment: looks at how past recommendations of the same
 * category actually turned out (advisor_recommendation_outcomes) and
 * nudges a new recommendation's starting confidence up/down. This is
 * the "gets smarter over time" mechanism — simple and auditable (an
 * admin can query the outcomes table and see exactly why a category's
 * confidence moved), not an opaque retrain.
 */
async function adjustConfidenceFromHistory(recommendations) {
  const { data, error } = await supabaseAdmin
    .from('advisor_recommendation_outcomes')
    .select('outcome, recommendation:advisor_recommendations(category)')
    .limit(500);

  if (error || !data || data.length === 0) return recommendations;

  const byCategory = {};
  for (const row of data) {
    const category = row.recommendation?.category;
    if (!category) continue;
    byCategory[category] = byCategory[category] || { improved: 0, neutral: 0, worsened: 0 };
    byCategory[category][row.outcome] = (byCategory[category][row.outcome] || 0) + 1;
  }

  return recommendations.map((r) => {
    const stats = byCategory[r.category];
    if (!stats) return r;
    const total = stats.improved + stats.neutral + stats.worsened;
    if (total < 3) return r; // not enough history yet to move confidence
    const successRate = stats.improved / total;
    // Blend the rule's own confidence with the category's track record,
    // weighted toward history as more outcomes accumulate (capped at 70/30
    // so a single rule never fully overrides its own stated confidence).
    const historyWeight = Math.min(0.7, total / 20);
    const adjusted = r.confidence * (1 - historyWeight) + successRate * historyWeight;
    return { ...r, confidence: Math.round(adjusted * 100) / 100 };
  });
}

async function runDailyAnalysis({ persist = true } = {}) {
  const snapshot = await collectSnapshot();
  const health = computeHealthScores(snapshot);
  const risks = await detectRisks(snapshot);
  const forecast = computeForecast(snapshot);

  const insights = buildInsights(snapshot);
  const opportunities = buildOpportunities(snapshot);
  let recommendations = buildRecommendations(snapshot, health, risks);
  recommendations = await adjustConfidenceFromHistory(recommendations);

  const report = {
    reportDate: new Date().toISOString().slice(0, 10),
    metrics: snapshot,
    insights,
    opportunities,
    healthScores: health,
    risks,
    forecast,
    recommendations,
  };

  if (!persist) return report;

  const { data: savedReport, error: reportError } = await supabaseAdmin
    .from('advisor_daily_reports')
    .upsert(
      {
        report_date: report.reportDate,
        metrics: snapshot,
        insights: [...insights, ...opportunities.map((o) => ({ text: o.text, metric: o.metadata }))],
        health_scores: health,
        risks,
        forecast,
      },
      { onConflict: 'report_date' }
    )
    .select()
    .single();

  if (reportError) {
    console.error('[advisor] failed to persist daily report:', reportError.message);
    return { ...report, persisted: false };
  }

  if (recommendations.length > 0) {
    const rows = recommendations.map((r) => ({
      report_id: savedReport.id,
      category: r.category,
      recommendation: r.recommendation,
      rationale: r.rationale,
      confidence: r.confidence,
      optimizer_actionable: r.optimizerActionable,
      metadata: r.metadata || {},
    }));
    const { error: recError } = await supabaseAdmin.from('advisor_recommendations').insert(rows);
    if (recError) console.error('[advisor] failed to persist recommendations:', recError.message);
  }

  return { ...report, persisted: true, reportId: savedReport.id };
}

async function getLatestReport() {
  const { data, error } = await supabaseAdmin
    .from('advisor_daily_reports')
    .select('*')
    .order('report_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function listRecommendations({ status = 'open', limit = 50 } = {}) {
  const { data, error } = await supabaseAdmin
    .from('advisor_recommendations')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function resolveRecommendation(id, { status, resolvedBy }) {
  if (!['applied', 'dismissed'].includes(status)) {
    const err = new Error('status must be "applied" or "dismissed"');
    err.code = 'invalid_status';
    throw err;
  }
  const { data, error } = await supabaseAdmin
    .from('advisor_recommendations')
    .update({ status, resolved_at: new Date().toISOString(), resolved_by: resolvedBy })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Records whether a resolved recommendation actually helped, once
 * there's enough new data to judge. Called manually by an admin today
 * (POST /api/v1/admin/advisor/recommendations/:id/outcome) — a fully
 * automatic version would need to define "enough time has passed to
 * judge X" per category, which is a product decision left open on
 * purpose rather than guessed at (see ARCHITECTURE.md).
 */
async function recordOutcome(recommendationId, outcome, metricDelta = {}) {
  if (!['improved', 'neutral', 'worsened'].includes(outcome)) {
    const err = new Error('outcome must be "improved", "neutral", or "worsened"');
    err.code = 'invalid_outcome';
    throw err;
  }
  const { data, error } = await supabaseAdmin
    .from('advisor_recommendation_outcomes')
    .insert({ recommendation_id: recommendationId, outcome, metric_delta: metricDelta })
    .select()
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  runDailyAnalysis,
  getLatestReport,
  listRecommendations,
  resolveRecommendation,
  recordOutcome,
};
