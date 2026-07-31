// ROX AI — src/modules/advisor/health.js
//
// Every score is 0-100, built from thresholds in config/advisor.json —
// not a trained model. That's a deliberate choice, same reasoning as
// lib/modelCosts.js's rates being "a config file to keep in sync," not
// a black box: an admin can see exactly why "Financial Health" is 61
// and adjust the threshold, instead of trusting an opaque number.
// clamp() keeps every score in range even if an input metric is
// missing or negative (a partial snapshot should degrade the score's
// confidence, never crash the endpoint).

const { advisor: config } = require('../../core/config');

function clamp(n, min = 0, max = 100) {
  if (typeof n !== 'number' || Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/** Maps a ratio against a {good, bad} threshold pair to a 0-100 score, linear between them. */
function scoreBetween(value, bad, good) {
  if (good === bad) return value >= good ? 100 : 0;
  const pct = (value - bad) / (good - bad);
  return clamp(Math.round(pct * 100));
}

function computeHealthScores(snapshot) {
  const t = snapshot.today || {};
  const y = snapshot.yesterday || {};
  const thresholds = config.healthThresholds;

  // Financial: profit margin (revenue - ai_cost) / revenue, and whether
  // margin24h shows any net-negative feature/model combo.
  const revenue = Number(t.revenue_usd || 0);
  const aiCost = Number(t.ai_cost_usd || 0);
  const marginPct = revenue > 0 ? (revenue - aiCost) / revenue : (aiCost > 0 ? -1 : 0);
  const negativeMarginCombos = (snapshot.margin24h || []).filter((m) => Number(m.margin_usd) < 0).length;
  const financial = clamp(
    scoreBetween(marginPct, thresholds.financial.marginBad, thresholds.financial.marginGood) -
      negativeMarginCombos * thresholds.financial.penaltyPerNegativeCombo
  );

  // Business: revenue trend + pro conversion signal (proUsers vs activeUsers).
  const revenueGrowth = y.revenue_usd ? (revenue - y.revenue_usd) / Math.max(1, y.revenue_usd) : 0;
  const conversionRatio = snapshot.activeUsersApprox
    ? (snapshot.proUsersCount || 0) / Math.max(1, snapshot.activeUsersApprox)
    : 0;
  const business = clamp(
    Math.round(
      scoreBetween(revenueGrowth, thresholds.business.growthBad, thresholds.business.growthGood) * 0.6 +
        scoreBetween(conversionRatio, thresholds.business.conversionBad, thresholds.business.conversionGood) * 0.4
    )
  );

  // Platform: job failure rates (image/video).
  const imgFailRate = snapshot.imageJobs24h.total ? snapshot.imageJobs24h.failed / snapshot.imageJobs24h.total : 0;
  const vidFailRate = snapshot.videoJobs24h.total ? snapshot.videoJobs24h.failed / snapshot.videoJobs24h.total : 0;
  const platform = clamp(
    100 -
      Math.round(imgFailRate * thresholds.platform.failurePenaltyWeight) -
      Math.round(vidFailRate * thresholds.platform.failurePenaltyWeight)
  );

  // Infrastructure: model circuit-breaker state (how many models are
  // currently tripped open = actively unavailable).
  const trippedModels = (snapshot.modelHealth || []).filter((m) => m.state === 'open').length;
  const infrastructure = clamp(100 - trippedModels * thresholds.infrastructure.penaltyPerTrippedModel);

  // Security: open critical/warning alerts (fraud/abuse/refund-failure
  // signals already logged to system_alerts by existing hardened code).
  const criticalAlerts = (snapshot.openAlerts || []).filter((a) => a.severity === 'critical').length;
  const warningAlerts = (snapshot.openAlerts || []).filter((a) => a.severity === 'warning').length;
  const security = clamp(
    100 - criticalAlerts * thresholds.security.penaltyPerCritical - warningAlerts * thresholds.security.penaltyPerWarning
  );

  // Growth: revenue growth trend.
  const growth = clamp(scoreBetween(revenueGrowth, thresholds.growth.bad, thresholds.growth.good));

  // Customer satisfaction: proxy only — job failure rate isn't a
  // survey, it's the closest signal available without a real NPS/CSAT
  // pipeline. Flagged explicitly so nobody mistakes this for real CSAT.
  const customerSatisfaction = clamp(100 - Math.round((imgFailRate + vidFailRate) * 50));

  return {
    business,
    financial,
    platform,
    infrastructure,
    security,
    growth,
    customerSatisfaction,
    _customerSatisfactionIsProxy: true,
    overall: clamp(
      Math.round((business + financial + platform + infrastructure + security + growth + customerSatisfaction) / 7)
    ),
  };
}

module.exports = { computeHealthScores };
