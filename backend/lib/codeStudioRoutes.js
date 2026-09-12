'use strict';

const express = require('express');
const { publicInventory } = require('./codeStudioRegistry');
const { normalizeCodeProject } = require('./codeProjectContract');
const { buildCodeArchiveManifest } = require('./codeArchiveManifest');
const { buildSafePreview } = require('./codePreviewPolicy');
const { assertRuntimeRequestAllowed, runtimeStatus } = require('./codeRuntimePolicy');
const { createCodeStudioUsageBridge } = require('./codeStudioUsageBridge');

function failureStatus(error) {
  if (String(error.code || '').includes('disabled') || String(error.code || '').startsWith('blocked_')) return 503;
  return 400;
}

function createCodeStudioRouter({ creditApi = null } = {}) {
  const router = express.Router();
  const usageBridge = createCodeStudioUsageBridge(creditApi || {});
  router.get('/capabilities', (_req, res) => res.json({ status: 'success', ...publicInventory(), runtime: runtimeStatus() }));
  router.post('/projects/validate', (req, res) => {
    try {
      const project = normalizeCodeProject(req.body?.project);
      const manifest = buildCodeArchiveManifest(project);
      const includePreview = req.body?.includePreview === true;
      const preview = includePreview ? buildSafePreview(project) : undefined;
      return res.json({ status: 'success', manifest, preview });
    } catch (error) {
      return res.status(failureStatus(error)).json({ status: 'error', code: error.code || 'invalid_code_project', message: 'Code project validation failed.' });
    }
  });
  router.post('/runtime/request', (req, res) => {
    try {
      assertRuntimeRequestAllowed(req.body);
      // Once a verified executor is enabled, billable code steps must reserve
      // through this injected bridge before execution and settle/refund using
      // the same requestId. Today runtime is disabled, so this cannot charge.
      const metering = usageBridge.status();
      if (!metering.reserve || !metering.settle || !metering.refund) {
        return res.status(503).json({ status: 'error', code: 'code_usage_ledger_unavailable' });
      }
      return res.status(501).json({ status: 'error', code: 'code_runtime_executor_unavailable' });
    } catch (error) {
      return res.status(failureStatus(error)).json({ status: 'error', code: error.code || 'code_runtime_disabled', operation: error.operation, message: 'Code execution is not enabled.' });
    }
  });
  router.post('/deploy/request', (req, res) => {
    try {
      assertRuntimeRequestAllowed({ ...req.body, operation: 'deploy' });
      return res.status(501).json({ status: 'error', code: 'code_runtime_executor_unavailable' });
    } catch (error) {
      return res.status(failureStatus(error)).json({ status: 'error', code: error.code || 'blocked_explicit_confirmation', operation: 'deploy', message: 'Deployment is not enabled.' });
    }
  });
  return router;
}

module.exports = { createCodeStudioRouter };
