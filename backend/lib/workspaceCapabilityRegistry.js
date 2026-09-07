'use strict';

const config = require('../config/workspace-system.v1.json');

function publicInventory() {
  return {
    schemaVersion: config.schemaVersion,
    mode: config.mode,
    foundations: { ...config.foundations },
    execution: { ...config.execution },
    limits: { ...config.limits },
    itemKinds: [...config.itemKinds],
    creationKinds: [...config.creationKinds],
    integrations: Object.fromEntries(Object.entries(config.integrations).map(([id, item]) => [id, { enabled: item.enabled, status: item.status }]))
  };
}

function assertWorkspaceExecutionAvailable(operation) {
  const map = {
    workspace_write: 'workspaceWritesEnabled',
    schedule_execute: 'scheduledExecutionEnabled',
    workflow_execute: 'workflowExecutionEnabled',
    plugin_install: 'pluginInstallEnabled',
    plugin_run: 'pluginRuntimeEnabled',
    drive_connect: 'driveOAuthEnabled',
    drive_read: 'driveReadEnabled',
    drive_write: 'driveWriteEnabled',
    external_export: 'externalExportsEnabled',
    publish: 'automaticPublishingEnabled'
  };
  const flag = map[operation];
  if (!flag || config.execution[flag] !== true) {
    const error = new Error('workspace_execution_disabled');
    error.code = operation ? `workspace_${operation}_disabled` : 'workspace_execution_disabled';
    error.operation = operation || null;
    throw error;
  }
  return true;
}

module.exports = { config, publicInventory, assertWorkspaceExecutionAvailable };
