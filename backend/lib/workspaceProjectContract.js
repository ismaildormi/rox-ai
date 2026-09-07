'use strict';

const { config } = require('./workspaceCapabilityRegistry');
const { object, text, uuid, fail } = require('./workspaceValidation');
const { normalizeWorkspaceItem } = require('./workspaceItemContract');

function normalizeWorkspaceProject(input) {
  const value = object(input, 'invalid_workspace_project');
  const items = Array.isArray(value.items) ? value.items.map(normalizeWorkspaceItem) : [];
  if (items.length > config.limits.projectItems) fail('workspace_project_item_limit');
  if (new Set(items.map(item => item.id)).size !== items.length) fail('duplicate_workspace_project_item');
  return {
    id: value.id == null ? null : uuid(value.id, 'invalid_workspace_project_id'),
    name: text(value.name, { code: 'invalid_workspace_project_name', max: config.limits.nameChars }),
    description: text(value.description, { code: 'invalid_workspace_project_description', max: config.limits.descriptionChars, optional: true }),
    items,
    sharedContextEnabled: value.sharedContextEnabled === true,
    externalSharingEnabled: false
  };
}

module.exports = { normalizeWorkspaceProject };
