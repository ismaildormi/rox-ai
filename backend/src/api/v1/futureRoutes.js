// ROX AI — src/api/v1/futureRoutes.js
//
// One router, mounted at /api/v1 in server.js, holding every endpoint
// for a feature that isn't built yet. Two things this buys:
//
//   1. A stable, documented URL a frontend/mobile team can start
//      integrating against today (it'll answer 404/"not enabled" with
//      a predictable shape), instead of a URL that doesn't exist until
//      the feature ships.
//   2. A single file that IS the map of "what's coming" for the API —
//      cross-reference with ARCHITECTURE.md's feature table.
//
// Every route: requireAuth -> flagGate(key) -> real handler (or the
// module's not-implemented stub, which throws a consistent error).
// When a feature is actually built, the route line itself usually
// doesn't change — only the handler function it calls does.

const express = require('express');
const { requireAuth } = require('../../../lib/auth');
const featureFlags = require('../../core/featureFlags');

const agents = require('../../modules/ai/agents');
const teams = require('../../modules/teams');
const plugins = require('../../modules/plugins');
const sdk = require('../../modules/sdk');
const growth = require('../../modules/billing/growth');

const router = express.Router();

/** Express middleware factory: 404s with a consistent shape if the flag is off. */
function flagGate(key) {
  return async function (req, res, next) {
    const enabled = await featureFlags.isEnabled(key, { userId: req.userId, orgId: req.orgId });
    if (!enabled) {
      return res.status(404).json({
        status: 'error',
        code: 'feature_not_enabled',
        feature: key,
        message: `This feature (${key}) is not available yet.`,
      });
    }
    next();
  };
}

/** Wraps a not-implemented module call into a uniform 501 instead of a raw 500. */
function notImplementedSafe(handler) {
  return async function (req, res) {
    try {
      const result = await handler(req, res);
      if (!res.headersSent) res.json({ status: 'success', data: result });
    } catch (err) {
      const status = err.code === 'not_implemented' ? 501 : 500;
      res.status(status).json({ status: 'error', code: err.code || 'internal_error', message: err.message });
    }
  };
}

// --- AI Agents (flag: ai_agents) ---
router.get('/agents', requireAuth, flagGate('ai_agents'), notImplementedSafe((req) => agents.listAgents(req.userId)));
router.post('/agents/:id/run', requireAuth, flagGate('ai_agents'), notImplementedSafe((req) => agents.runAgent(req.params.id, req.body, { userId: req.userId })));

// --- Teams / Organizations / Workspaces ---
router.get('/organizations', requireAuth, flagGate('organizations'), notImplementedSafe((req) => teams.listOrganizationsForUser(req.userId)));
router.post('/organizations', requireAuth, flagGate('organizations'), notImplementedSafe((req) => teams.createOrganization(req.body.name, req.userId)));
router.get('/organizations/:orgId/workspaces', requireAuth, flagGate('workspaces'), notImplementedSafe((req) => teams.listWorkspaces(req.params.orgId)));

// --- Plugins / Extensions / Marketplace ---
router.get('/plugins', requireAuth, flagGate('plugins'), notImplementedSafe((req) => plugins.listInstalled(req.userId)));
router.post('/plugins/install', requireAuth, flagGate('plugins'), notImplementedSafe((req) => plugins.installPlugin(req.body.manifest, req.userId)));

// --- Public API / SDK (self-serve API keys) ---
router.get('/api-keys', requireAuth, flagGate('public_api_access'), notImplementedSafe(() => { throw Object.assign(new Error('API key management is not implemented yet.'), { code: 'not_implemented' }); }));

// --- Referral / Affiliate ---
router.get('/referral-code', requireAuth, flagGate('referral_system'), notImplementedSafe((req) => growth.getReferralCode(req.userId)));
router.post('/referral-code/redeem', requireAuth, flagGate('referral_system'), notImplementedSafe((req) => growth.redeemReferralCode(req.body.code, req.userId)));

module.exports = router;
