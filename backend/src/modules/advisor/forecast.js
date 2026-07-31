// ROX AI — src/modules/advisor/forecast.js
//
// Linear trend over the trailing window (default 30 days, configurable
// in config/advisor.json) projected 30 days forward. Deliberately NOT a
// trained time-series model — with a fresh product and a short history,
// a simple, explainable trend line beats an overfit model that looks
// more sophisticated than the data supports. Every forecast reports its
// own confidence (based on how many days of real data it had and how
// noisy they were) instead of a false-precision single number, so an
// admin can tell "this is a real trend" from "this is three data points."

const { advisor: config } = require('../../core/config');

/** Ordinary least squares slope/intercept over [ {x, y} ]. */
function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function confidenceFor(points) {
  const min = config.forecast.minDaysForHighConfidence;
  if (points.length >= min) return 'high';
  if (points.length >= Math.ceil(min / 2)) return 'medium';
  return 'low';
}

function projectMetric(series, key, daysForward) {
  const window = series.slice(-config.forecast.trendWindowDays);
  const points = window.map((row, i) => ({ x: i, y: Number(row[key] || 0) }));
  const fit = linearRegression(points);
  if (!fit) return { projected: points[0]?.y ?? 0, confidence: 'low' };
  const projected = fit.intercept + fit.slope * (points.length - 1 + daysForward);
  return { projected: Math.max(0, Math.round(projected * 100) / 100), confidence: confidenceFor(points), trendPerDay: Math.round(fit.slope * 100) / 100 };
}

function computeForecast(snapshot) {
  const series = snapshot.dailySeries || [];
  const daysForward = 30;

  const revenue = projectMetric(series, 'revenue_usd', daysForward);
  const aiCost = projectMetric(series, 'ai_cost_usd', daysForward);
  const chat = projectMetric(series, 'chat_requests', daysForward);
  const image = projectMetric(series, 'image_jobs', daysForward);
  const video = projectMetric(series, 'video_jobs', daysForward);

  const revenueNextMonth = revenue.projected * daysForward;
  const aiCostNextMonth = aiCost.projected * daysForward;

  return {
    windowDaysUsed: Math.min(series.length, config.forecast.trendWindowDays),
    revenueNextMonthUsd: Math.round(revenueNextMonth * 100) / 100,
    profitNextMonthUsd: Math.round((revenueNextMonth - aiCostNextMonth) * 100) / 100,
    expectedAiCostNextMonthUsd: Math.round(aiCostNextMonth * 100) / 100,
    expectedServerCostNextMonthUsd: null, // no server-cost ledger exists yet — see ARCHITECTURE.md note
    growthRatePctPerDay: revenue.trendPerDay && revenue.projected ? Math.round((revenue.trendPerDay / Math.max(0.01, revenue.projected)) * 10000) / 100 : 0,
    subscriptionGrowthTrendPerDay: null, // needs a subscriptions-over-time series; profiles only has a current snapshot today
    creditConsumptionTrend: { chat, image, video },
    storageGrowth: null, // no storage usage ledger exists yet — see ARCHITECTURE.md note
    confidence: revenue.confidence,
  };
}

module.exports = { computeForecast };
