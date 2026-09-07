'use strict';

const express = require('express');
const { publicReadinessInventory } = require('./finalProductRegistry');
const { evaluateLaunchReadiness, assertLaunchAllowed } = require('./launchReadinessGate');
const { normalizeUsagePresentation } = require('./usagePresentationContract');
const { normalizeAnalyticsPresentation } = require('./analyticsPresentationContract');
const { normalizeSettings, normalizeDataRightsRequest } = require('./settingsPrivacyContract');
const { normalizeNotification } = require('./notificationContract');
const { normalizeAppCandidate } = require('./appReadinessContract');

function invalid(res, error) { return res.status(400).json({ status: 'error', code: error.code || 'invalid_final_product_request', message: 'Final product request validation failed.' }); }
function createFinalProductRouter() {
  const router = express.Router();
  router.get('/readiness', (_req, res) => res.json({ status: 'success', ...publicReadinessInventory(), launch: evaluateLaunchReadiness() }));
  router.post('/usage/validate', (req, res) => { try { return res.json({ status: 'success', usage: normalizeUsagePresentation(req.body?.usage), persisted: false }); } catch (error) { return invalid(res, error); } });
  router.post('/analytics/validate', (req, res) => { try { return res.json({ status: 'success', analytics: normalizeAnalyticsPresentation(req.body?.analytics), persisted: false }); } catch (error) { return invalid(res, error); } });
  router.post('/settings/validate', (req, res) => { try { return res.json({ status: 'success', settings: normalizeSettings(req.body?.settings), persisted: false }); } catch (error) { return invalid(res, error); } });
  router.post('/data-rights/validate', (req, res) => { try { return res.json({ status: 'success', request: normalizeDataRightsRequest(req.body?.request), persisted: false }); } catch (error) { return invalid(res, error); } });
  router.post('/notifications/validate', (req, res) => { try { return res.json({ status: 'success', notification: normalizeNotification(req.body?.notification), persisted: false }); } catch (error) { return invalid(res, error); } });
  router.post('/apps/validate', (req, res) => { try { return res.json({ status: 'success', candidate: normalizeAppCandidate(req.body?.candidate), persisted: false }); } catch (error) { return invalid(res, error); } });
  router.post('/launch/request', (_req, res) => {
    try { assertLaunchAllowed(); return res.status(501).json({ status: 'error', code: 'launch_executor_unavailable' }); }
    catch (error) { return res.status(503).json({ status: 'error', code: error.code || 'zuvyr_launch_blocked', blockers: error.blockers || [], launched: false, billingActivated: false, deployed: false, storeSubmitted: false }); }
  });
  return router;
}

module.exports = { createFinalProductRouter };
