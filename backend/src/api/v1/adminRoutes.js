// ROX AI — src/api/v1/adminRoutes.js
//
// Everything here is requireAuth -> requireAdmin -> flagGate(key) ->
// module call, same pattern futureRoutes.js already established. Two
// flags gate this surface: `business_advisor` and `auto_optimizer`
// (config/feature-flags.json) — both are independent of `admin_dashboard`
// (the planned UI shell) since this backend/API layer is useful the
// moment it exists, from curl or an internal script, even before a
// dashboard renders it.
//
// See docs/API.md for the full request/response reference.

const express = require('express');
const { requireAuth } = require('../../../lib/auth');
const { requireAdmin } = require('../../../lib/requireAdmin');
const featureFlags = require('../../core/featureFlags');
const advisor = require('../../modules/advisor');
const optimizer = require('../../modules/optimizer');
const diskMonitor = require('../../modules/diskMonitor');
const diskMaintenance = require('../../modules/diskMonitor/maintenance');

const router = express.Router();

function flagGate(key) {
  return async function (req, res, next) {
    const enabled = await featureFlags.isEnabled(key, { userId: req.userId });
    if (!enabled) {
      return res.status(404).json({ status: 'error', code: 'feature_not_enabled', feature: key, message: `This feature (${key}) is not available yet.` });
    }
    next();
  };
}

function wrap(handler) {
  return async function (req, res) {
    try {
      const result = await handler(req, res);
      if (!res.headersSent) res.json({ status: 'success', data: result });
    } catch (err) {
      const statusByCode = {
        not_implemented: 501,
        invalid_status: 400,
        invalid_outcome: 400,
        invalid_mode: 400,
        requires_manual_approval: 409,
        safety_rule_violation: 409,
        daily_action_limit_reached: 429,
        cooldown_active: 429,
        already_reversed: 409,
        unknown_action: 400,
        invalid_decision: 400,
        already_resolved: 409,
        invalid_target: 400,
      };
      const status = statusByCode[err.code] || 500;
      res.status(status).json({ status: 'error', code: err.code || 'internal_error', message: err.message });
    }
  };
}

const gate = [requireAuth, requireAdmin];

// --- Business Advisor ---------------------------------------------------

router.get('/advisor/report/latest', ...gate, flagGate('business_advisor'), wrap(() => advisor.getLatestReport()));

// On-demand run — same function the daily cron calls (see /internal/advisor/run-daily
// in server.js). Useful for testing/demoing without waiting for the schedule.
router.post('/advisor/report/run', ...gate, flagGate('business_advisor'), wrap(() => advisor.runDailyAnalysis()));

router.get('/advisor/recommendations', ...gate, flagGate('business_advisor'), wrap((req) => advisor.listRecommendations({ status: req.query.status || 'open' })));

router.post('/advisor/recommendations/:id/resolve', ...gate, flagGate('business_advisor'), wrap((req) =>
  advisor.resolveRecommendation(req.params.id, { status: req.body.status, resolvedBy: req.userId })
));

router.post('/advisor/recommendations/:id/outcome', ...gate, flagGate('business_advisor'), wrap((req) =>
  advisor.recordOutcome(req.params.id, req.body.outcome, req.body.metricDelta || {})
));

// --- Auto Optimizer -------------------------------------------------------

router.get('/optimizer/settings', ...gate, flagGate('auto_optimizer'), wrap(() => optimizer.getSettings()));

router.post('/optimizer/mode', ...gate, flagGate('auto_optimizer'), wrap((req) => optimizer.setMode(req.body.mode, req.userId)));

router.post('/optimizer/safety-rules', ...gate, flagGate('auto_optimizer'), wrap((req) => optimizer.updateSafetyRules(req.body.safetyRules || {}, req.userId)));

router.get('/optimizer/actions', ...gate, flagGate('auto_optimizer'), wrap((req) => optimizer.listActions({ limit: Number(req.query.limit) || 50 })));

// Manual "apply this recommendation now" path — a human clicking Apply
// in the dashboard. Goes through the exact same safety-rule check as
// the automatic sweep; being an admin doesn't raise the ceiling.
router.post('/optimizer/actions/apply', ...gate, flagGate('auto_optimizer'), wrap((req) =>
  optimizer.applyAction(req.body.action, `admin:${req.userId}`)
));

router.post('/optimizer/actions/:id/revert', ...gate, flagGate('auto_optimizer'), wrap((req) =>
  optimizer.revertAction(req.params.id, req.userId)
));

// Manual trigger for the automatic-mode sweep — lets an admin run it
// once, see exactly what it would apply/skip, without waiting for the
// scheduled run or flipping to automatic mode blind.
router.post('/optimizer/sweep/run', ...gate, flagGate('auto_optimizer'), wrap(() => optimizer.runAutomaticSweep()));

// --- Disk Space Monitor ----------------------------------------------------

router.get('/disk/report', ...gate, flagGate('disk_monitor'), wrap(() => diskMonitor.getFullReport()));

router.get('/disk/latest', ...gate, flagGate('disk_monitor'), wrap(() => diskMonitor.getLatestSnapshot()));

router.get('/disk/settings', ...gate, flagGate('disk_monitor'), wrap(() => diskMonitor.getSettings()));

router.put('/disk/settings', ...gate, flagGate('disk_monitor'), wrap((req) => diskMonitor.updateSettings(req.body || {}, req.userId)));

// Non-destructive-to-user-data actions (temp/cache/logs/backups/docker
// images) — runnable directly by an admin, no confirmation flow needed.
// The route layer doesn't decide which actions those are; runAction()
// itself enforces NEVER_AUTO regardless of who calls it.
router.post('/disk/actions/:actionType/run', ...gate, flagGate('disk_monitor'), wrap((req) =>
  diskMaintenance.runAction(req.params.actionType, `admin:${req.userId}`, req.body?.description)
));

router.get('/disk/actions/log', ...gate, flagGate('disk_monitor'), wrap((req) => diskMaintenance.listMaintenanceLog({ limit: Number(req.query.limit) || 50 })));

// Confirmation flow — required before touching an Ollama model, user
// uploads, or generated content, in manual or automatic mode alike.
router.post('/disk/confirmations/request', ...gate, flagGate('disk_monitor'), wrap((req) =>
  diskMaintenance.requestConfirmation({ ...req.body, requestedBy: `admin:${req.userId}` })
));

router.get('/disk/confirmations/pending', ...gate, flagGate('disk_monitor'), wrap(() => diskMaintenance.listPendingConfirmations()));

router.post('/disk/confirmations/:id/resolve', ...gate, flagGate('disk_monitor'), wrap((req) =>
  diskMaintenance.resolveConfirmation(req.params.id, req.body.decision, req.userId)
));

module.exports = router;
