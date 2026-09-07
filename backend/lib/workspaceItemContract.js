'use strict';

const { config } = require('./workspaceCapabilityRegistry');
const { object, text, uuid, fail } = require('./workspaceValidation');

function normalizeWorkspaceItem(input) {
  const value = object(input, 'invalid_workspace_item');
  if (!config.itemKinds.includes(value.kind)) fail('invalid_workspace_item_kind');
  const item = {
    id: uuid(value.id, 'invalid_workspace_item_id'),
    kind: value.kind,
    name: text(value.name, { code: 'invalid_workspace_item_name', max: config.limits.nameChars }),
    description: text(value.description, { code: 'invalid_workspace_item_description', max: config.limits.descriptionChars, optional: true }),
    sourceId: value.sourceId == null ? null : uuid(value.sourceId, 'invalid_workspace_source_id'),
    archived: value.archived === true,
    metadata: {}
  };
  if (value.metadata !== undefined) {
    const metadata = object(value.metadata, 'invalid_workspace_item_metadata');
    const serialized = JSON.stringify(metadata);
    if (serialized.length > 10000 || /(?:authorization|cookie|password|secret|api[_-]?key|access[_-]?token)/i.test(serialized)) fail('workspace_item_sensitive_metadata');
    item.metadata = JSON.parse(serialized);
  }
  return item;
}

module.exports = { normalizeWorkspaceItem };
