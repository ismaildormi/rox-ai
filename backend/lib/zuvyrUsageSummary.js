'use strict';

// Pack 018 read-only account usage source.
// Never reserve, settle, reset windows, mutate billing state, or call a provider.

const {
  normalizePlanId
} = require('./planEntitlements');
const {
  buildCapacityWarnings
} = require('./capacityProtection');

const PROFILE_FIELDS = [
  'subscription_status',
  'topup_credits_balance',
  'usage_units_total',
  'usage_units_used',
  'usage_window_started_at',
  'usage_window_ends_at',
  'usage_week_units_total',
  'usage_week_units_used',
  'usage_week_started_at',
  'usage_week_ends_at'
].join(',');

const USAGE_FIELDS = [
  'id',
  'capability',
  'usage_kind',
  'funding_source',
  'reserved_credits',
  'actual_credits',
  'refunded_credits',
  'state',
  'accounting_state',
  'created_at',
  'settled_at',
  'updated_at'
].join(',');

const integer = value =>
  Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

function windowSummary(total, used, start, end, now) {
  total = integer(total);
  used = integer(used);

  const begins =
    typeof start === 'string'
      ? Date.parse(start)
      : NaN;
  const ends =
    typeof end === 'string'
      ? Date.parse(end)
      : NaN;
  const validDates =
    Number.isFinite(begins) &&
    Number.isFinite(ends) &&
    ends > begins;

  const state =
    total === null
      ? 'unconfigured'
      : used === null || !validDates
        ? 'unavailable'
        : begins > now
          ? 'not_started'
          : ends <= now
            ? 'expired'
            : 'active';

  return {
    state,
    total,
    used,
    remaining:
      state === 'active'
        ? Math.max(0, total - used)
        : null,
    startedAt:
      validDates
        ? new Date(begins).toISOString()
        : null,
    endsAt:
      validDates
        ? new Date(ends).toISOString()
        : null
  };
}

function publicUsageRecord(row) {
  const state =
    typeof row.accounting_state === 'string' &&
    row.accounting_state.trim()
      ? row.accounting_state.trim()
      : typeof row.state === 'string'
        ? row.state.trim()
        : 'unknown';

  const actual = integer(row.actual_credits);
  const reserved = integer(row.reserved_credits);
  const refunded = integer(row.refunded_credits);

  let creditsCharged = null;

  if (state === 'used' || state === 'settled') {
    creditsCharged = actual;
  } else if (state === 'refunded' || state === 'cancelled') {
    creditsCharged = actual === null ? 0 : actual;
  }

  return {
    id: row.id == null ? null : String(row.id),
    capability:
      typeof row.capability === 'string'
        ? row.capability
        : 'unknown',
    usageKind:
      typeof row.usage_kind === 'string'
        ? row.usage_kind
        : 'request',
    state,
    fundingSource:
      typeof row.funding_source === 'string'
        ? row.funding_source
        : null,
    reservedCredits: reserved,
    creditsCharged,
    refundedCredits: refunded,
    createdAt: row.created_at || null,
    finishedAt:
      row.settled_at ||
      row.updated_at ||
      null
  };
}

function mountZuvyrUsageSummary(
  app,
  { requireAuth, db, now = Date.now }
) {
  app.get(
    '/api/zuvyr-usage-summary',
    requireAuth,
    async (req, res) => {
      res.set('Cache-Control', 'private, no-store');
      res.set('Vary', 'Authorization');

      if (!req.userId) {
        return res.status(401).json({
          status: 'error',
          code: 'authentication_required'
        });
      }

      try {
        const profile = await db
          .from('profiles')
          .select(PROFILE_FIELDS)
          .eq('id', req.userId)
          .single();

        if (profile.error || !profile.data) {
          throw new Error('profile_unavailable');
        }

        const p = profile.data;
        const time = now();

        const fiveHour = windowSummary(
          p.usage_units_total,
          p.usage_units_used,
          p.usage_window_started_at,
          p.usage_window_ends_at,
          time
        );

        const weekly = windowSummary(
          p.usage_week_units_total,
          p.usage_week_units_used,
          p.usage_week_started_at,
          p.usage_week_ends_at,
          time
        );

        const warnings = buildCapacityWarnings({
          fiveHourTotal: fiveHour.total,
          fiveHourRemaining: fiveHour.remaining,
          weeklyTotal: weekly.total,
          weeklyRemaining: weekly.remaining
        });

        let history = {
          data: null,
          error: true
        };

        try {
          history = await db
            .from('zuvyr_usage_records')
            .select(USAGE_FIELDS)
            .eq('user_id', req.userId)
            .order('created_at', {
              ascending: false
            })
            .limit(20);
        } catch (_) {
          // Current balances remain useful if request history is unavailable.
        }

        const historyAvailable =
          !history.error &&
          Array.isArray(history.data);

        const recentRequests =
          historyAvailable
            ? history.data.map(publicUsageRecord)
            : [];

        const recentChat = recentRequests.filter(
          item =>
            String(item.capability || '')
              .trim()
              .toLowerCase() === 'chat'
        );

        return res.json({
          status: 'success',
          version:
            'pack-018.unified-usage-billing-ux.v1',
          checkedAt:
            new Date(time).toISOString(),
          plan:
            normalizePlanId(
              p.subscription_status
            ),
          topupCredits:
            integer(
              p.topup_credits_balance
            ),
          fiveHour,
          weekly,
          warnings,
          recentRequestsAvailable:
            historyAvailable,
          recentRequests,
          // Compatibility fields retained for existing Usage UI consumers.
          recentChatAvailable:
            historyAvailable,
          recentChat
        });
      } catch (_) {
        return res.status(503).json({
          status: 'error',
          code: 'usage_unavailable',
          message:
            'Usage could not be loaded. Please retry.'
        });
      }
    }
  );
}

module.exports = {
  mountZuvyrUsageSummary,
  windowSummary,
  publicUsageRecord
};
