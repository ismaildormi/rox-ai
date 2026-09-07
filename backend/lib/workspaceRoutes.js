'use strict';

const express = require('express');
const { publicInventory, assertWorkspaceExecutionAvailable } = require('./workspaceCapabilityRegistry');
const { normalizeWorkspaceItem } = require('./workspaceItemContract');
const { normalizeWorkspaceProject } = require('./workspaceProjectContract');
const { normalizeCreation } = require('./workspaceCreationContract');
const { normalizeTemplate } = require('./workspaceTemplateContract');
const { normalizeSchedule } = require('./workspaceScheduleContract');
const { normalizeIntegrationRequest, assertNoCredentialMaterial } = require('./workspaceIntegrationContract');
const { normalizeWorkflow } = require('./workspaceWorkflowContract');

function validation(res, error) {
  return res.status(400).json({ status: 'error', code: error.code || 'invalid_workspace_request', message: 'Workspace request validation failed.' });
}

function disabled(res, operation) {
  try { assertWorkspaceExecutionAvailable(operation); }
  catch (error) { return res.status(503).json({ status: 'error', code: error.code, operation, executionEnabled: false, externalWriteExecuted: false }); }
  return res.status(501).json({ status: 'error', code: 'workspace_executor_unavailable', operation, executionEnabled: false, externalWriteExecuted: false });
}

function createWorkspaceRouter() {
  const router = express.Router();
  router.get('/capabilities', (_req, res) => res.json({ status: 'success', ...publicInventory() }));
  router.post('/library/items/validate', (req, res) => { try { return res.json({ status: 'success', item: normalizeWorkspaceItem(req.body?.item), persisted: false }); } catch (error) { return validation(res, error); } });
  router.post('/projects/validate', (req, res) => { try { return res.json({ status: 'success', project: normalizeWorkspaceProject(req.body?.project), persisted: false }); } catch (error) { return validation(res, error); } });
  router.post('/creations/validate', (req, res) => { try { return res.json({ status: 'success', creation: normalizeCreation(req.body?.creation), generated: false }); } catch (error) { return validation(res, error); } });
  router.post('/templates/validate', (req, res) => { try { return res.json({ status: 'success', template: normalizeTemplate(req.body?.template), persisted: false }); } catch (error) { return validation(res, error); } });
  router.post('/workflows/validate', (req, res) => { try { return res.json({ status: 'success', workflow: normalizeWorkflow(req.body?.workflow), persisted: false }); } catch (error) { return validation(res, error); } });
  router.post('/schedules/validate', (req, res) => { try { return res.json({ status: 'success', schedule: normalizeSchedule(req.body?.schedule), persisted: false }); } catch (error) { return validation(res, error); } });
  router.post('/integrations/validate', (req, res) => { try { assertNoCredentialMaterial(req.body); return res.json({ status: 'success', request: normalizeIntegrationRequest(req.body?.request), connected: false }); } catch (error) { return validation(res, error); } });
  router.post('/workflows/execute', (_req, res) => disabled(res, 'workflow_execute'));
  router.post('/schedules/activate', (_req, res) => disabled(res, 'schedule_execute'));
  router.post('/plugins/install', (_req, res) => disabled(res, 'plugin_install'));
  router.post('/drive/connect', (_req, res) => disabled(res, 'drive_connect'));
  router.post('/exports/create', (_req, res) => disabled(res, 'external_export'));
  return router;
}

module.exports = { createWorkspaceRouter };
