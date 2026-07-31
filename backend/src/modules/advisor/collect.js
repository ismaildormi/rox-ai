// ROX AI — src/modules/advisor/collect.js
//
// Pulls every number the Business Advisor reasons about from tables and
// views that ALREADY exist (rox_daily_business_snapshot, rox_margin_last_24h/7d,
// system_alerts, generation_jobs, credit_audit_log, model health) plus
// the two new ones this feature adds (revenue_events, advisor_* tables).
// This file does no analysis — it's the "what happened" gather step;
// insights.js/health.js/risk.js/forecast.js do the "what it means" step.
// Kept as a separate module so any of those four can be re-run against
// the same snapshot without re-querying the DB four times.

const { supabaseAdmin } = require('../../../lib/supabaseAdmin');

async function safeQuery(promise, fallback) {
  try {
    const { data, error } = await promise;
    if (error) {
      console.error('[advisor/collect]', error.message);
      return fallback;
    }
    return data ?? fallback;
  } catch (err) {
    console.error('[advisor/collect]', err.message);
    return fallback;
  }
}

/**
 * @returns {Promise<object>} one day's full metric snapshot, plus enough
 *          trailing history (from rox_daily_business_snapshot, 90 days)
 *          for delta/trend/forecast math downstream.
 */
async function collectSnapshot() {
  const [
    dailySeries,
    margin24h,
    margin7d,
    openAlerts,
    modelHealth,
    activeUsers,
    proUsers,
    imageJobs24h,
    videoJobs24h,
    creditAudit24h,
  ] = await Promise.all([
    safeQuery(supabaseAdmin.from('rox_daily_business_snapshot').select('*').order('day', { ascending: true }), []),
    safeQuery(supabaseAdmin.from('rox_margin_last_24h').select('*'), []),
    safeQuery(supabaseAdmin.from('rox_margin_last_7d').select('*'), []),
    safeQuery(supabaseAdmin.from('system_alerts').select('*').eq('acknowledged', false).order('created_at', { ascending: false }).limit(50), []),
    safeQuery(supabaseAdmin.from('model_health').select('*'), []),
    safeQuery(supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).gte('last_reset_date', new Date(Date.now() - 30 * 86400000).toISOString()), null),
    safeQuery(supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).eq('subscription_status', 'pro'), null),
    safeQuery(supabaseAdmin.from('generation_jobs').select('status, feature').eq('feature', 'image').gte('created_at', new Date(Date.now() - 86400000).toISOString()), []),
    safeQuery(supabaseAdmin.from('generation_jobs').select('status, feature').eq('feature', 'video').gte('created_at', new Date(Date.now() - 86400000).toISOString()), []),
    safeQuery(supabaseAdmin.from('credit_audit_log').select('feature, status, credits_consumed').gte('created_at', new Date(Date.now() - 86400000).toISOString()), []),
  ]);

  const today = dailySeries[dailySeries.length - 1] || {};
  const yesterday = dailySeries[dailySeries.length - 2] || {};

  const featureUsage24h = creditAudit24h.reduce((acc, row) => {
    acc[row.feature] = acc[row.feature] || { requests: 0, blocked: 0, credits: 0 };
    acc[row.feature].requests += 1;
    if (row.status === 'blocked') acc[row.feature].blocked += 1;
    acc[row.feature].credits += row.credits_consumed || 0;
    return acc;
  }, {});

  return {
    collectedAt: new Date().toISOString(),
    dailySeries,               // last 90 days, oldest first
    today,
    yesterday,
    margin24h,                 // per feature+model: cost/margin/credits
    margin7d,
    openAlerts,                // system_alerts not yet acknowledged
    modelHealth,               // circuit-breaker state per model
    activeUsersApprox: activeUsers,
    proUsersCount: proUsers,
    imageJobs24h: { total: imageJobs24h.length, failed: imageJobs24h.filter((j) => j.status === 'failed').length },
    videoJobs24h: { total: videoJobs24h.length, failed: videoJobs24h.filter((j) => j.status === 'failed').length },
    featureUsage24h,
  };
}

module.exports = { collectSnapshot };
