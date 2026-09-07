'use strict';

const express = require('express');
const definition = require('../config/unified-product.v1.json');
const { buildCrossFeaturePlan, approveCrossFeaturePlan } = require('./crossFeatureOrchestration');
const { ALLOWED_SCOPES, buildIpToolPlan } = require('./zuvyrIpToolAccess');

function invalid(res, error) {
  return res.status(400).json({ status: 'error', code: error.code || 'invalid_unified_product_request', executionEnabled: false });
}

function createUnifiedProductRouter() {
  const router = express.Router();
  router.get('/catalog', (_req, res) => res.json({
    status: 'success', version: definition.version, identity: definition.identity,
    sections: definition.sections, capabilities: definition.capabilities,
    connections: definition.connections, orchestration: definition.orchestration,
    zuvyrIp: definition.zuvyrIp, ipScopes: [...ALLOWED_SCOPES]
  }));
  router.post('/orchestration/plan', (req, res) => {
    try { return res.json({ status: 'success', plan: buildCrossFeaturePlan(req.body) }); }
    catch (error) { return invalid(res, error); }
  });
  router.post('/orchestration/approve', (req, res) => {
    try { return res.status(503).json({ status: 'blocked', ...approveCrossFeaturePlan(req.body) }); }
    catch (error) { return invalid(res, error); }
  });
  router.post('/ip/plan', (req, res) => {
    try { return res.json({ status: 'success', plan: buildIpToolPlan(req.body) }); }
    catch (error) { return invalid(res, error); }
  });
  return router;
}

module.exports = { createUnifiedProductRouter };
