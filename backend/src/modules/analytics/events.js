// ROX AI — src/modules/analytics/events.js
// Extension point for the future "Analytics Dashboard" (flag:
// analytics_dashboard). Product analytics (feature usage, funnel
// steps) is a DIFFERENT concern from lib/metrics.js (Prometheus,
// operational/infra metrics) and from credit_audit_log (billing
// ledger) — conflating the three is how metrics systems become
// unmaintainable. This one writes append-only rows to table
// `analytics_events` (see 12_extension_schema.sql); nothing reads them
// yet (that's the dashboard, when built).
//
// track() is intentionally fire-and-forget and never throws — an
// analytics write must never be able to fail a user-facing request.

const { makeLogger } = require('../../core/logger');
const log = makeLogger('analytics');

let supabaseAdmin = null;
try {
  ({ supabaseAdmin } = require('../../../lib/supabaseAdmin'));
} catch (_) {
  supabaseAdmin = null;
}

function track(eventName, properties = {}, context = {}) {
  if (!supabaseAdmin) return;
  supabaseAdmin
    .from('analytics_events')
    .insert([{ event_name: eventName, properties, user_id: context.userId || null, org_id: context.orgId || null }])
    .then(({ error }) => {
      if (error) log.warn('failed to record analytics event', { eventName, error: error.message });
    });
}

module.exports = { track };
