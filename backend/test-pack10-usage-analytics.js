'use strict';
const assert = require('node:assert/strict');
const { normalizeUsagePresentation } = require('./lib/usagePresentationContract');
const { normalizeAnalyticsPresentation } = require('./lib/analyticsPresentationContract');
const usage = normalizeUsagePresentation({
  plan: 'pro',
  fiveHour: { total: 100, used: 25, startsAt: '2026-09-07T00:00:00.000Z', endsAt: '2026-09-07T05:00:00.000Z' },
  weekly: { total: null, used: 0, startsAt: null, endsAt: null },
  topupBalance: 700,
  topupChoiceRequired: true
});
assert.equal(usage.fiveHour.remaining, 75);
assert.equal(usage.fiveHour.progressPercent, 25);
assert.equal(usage.weekly.configured, false);
assert.equal(usage.topup.persistent, true);
assert.equal(usage.topup.silentlyConsumed, false);
assert.equal(usage.topupChoiceRequired, true);
assert.equal(usage.autoReloadEnabled, false);
assert.throws(() => normalizeUsagePresentation({ plan: 'pro', fiveHour: { total: 10, used: 11, startsAt: null, endsAt: null }, weekly: { total: null, used: 0, startsAt: null, endsAt: null }, topupBalance: 0 }), /invalid_five_hour_usage/);
const analytics = normalizeAnalyticsPresentation({ rangeDays: 7, points: [{ date: '2026-09-07', requests: 3, credits: 8, revenueMicroUsd: 10000, costMicroUsd: 4000 }] });
assert.equal(analytics.points[0].grossProfitMicroUsd, 6000);
assert.equal(analytics.moneyUnit, 'micro_usd');
assert.equal(analytics.containsRawPrompts, false);
assert.throws(() => normalizeAnalyticsPresentation({ rangeDays: 365, points: [] }), /invalid_analytics_range/);
console.log('PASS: Pack 10 separate allowance/top-up Usage and privacy-safe 7/30-day Analytics contracts');
