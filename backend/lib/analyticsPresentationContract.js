'use strict';

const { config } = require('./finalProductRegistry');

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function amount(value, code) { if (!Number.isSafeInteger(value) || value < 0) fail(code); return value; }
function normalizeAnalyticsPresentation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_analytics_presentation');
  if (!config.analyticsRangesDays.includes(input.rangeDays)) fail('invalid_analytics_range');
  if (!Array.isArray(input.points) || input.points.length > input.rangeDays) fail('invalid_analytics_points');
  const points = input.points.map(point => {
    if (!point || typeof point !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(point.date)) fail('invalid_analytics_point');
    return {
      date: point.date,
      requests: amount(point.requests, 'invalid_analytics_requests'),
      credits: amount(point.credits, 'invalid_analytics_credits'),
      revenueMicroUsd: amount(point.revenueMicroUsd, 'invalid_analytics_revenue'),
      costMicroUsd: amount(point.costMicroUsd, 'invalid_analytics_cost'),
      grossProfitMicroUsd: Number.isSafeInteger(point.revenueMicroUsd - point.costMicroUsd) ? point.revenueMicroUsd - point.costMicroUsd : fail('invalid_analytics_profit')
    };
  });
  return { rangeDays: input.rangeDays, points, containsRawPrompts: false, containsSecrets: false, currency: 'USD', moneyUnit: 'micro_usd' };
}
module.exports = { normalizeAnalyticsPresentation };
