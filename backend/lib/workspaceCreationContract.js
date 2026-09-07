'use strict';

const { config } = require('./workspaceCapabilityRegistry');
const { object, text, fail } = require('./workspaceValidation');

function normalizeCells(cells) {
  if (!Array.isArray(cells) || cells.length > 1000) fail('invalid_spreadsheet_cells');
  return cells.map(cell => {
    const value = object(cell, 'invalid_spreadsheet_cell');
    const address = text(value.address, { code: 'invalid_spreadsheet_address', max: 12 }).toUpperCase();
    if (!/^[A-Z]{1,3}[1-9][0-9]{0,5}$/.test(address)) fail('invalid_spreadsheet_address');
    if (typeof value.value === 'string' && /^[=+\-@]/.test(value.value.trim())) fail('spreadsheet_formula_execution_disabled');
    if (!['string', 'number', 'boolean'].includes(typeof value.value) && value.value !== null) fail('invalid_spreadsheet_value');
    return { address, value: value.value };
  });
}

function normalizeCreation(input) {
  const value = object(input, 'invalid_workspace_creation');
  if (!config.creationKinds.includes(value.kind)) fail('invalid_workspace_creation_kind');
  const result = {
    kind: value.kind,
    title: text(value.title, { code: 'invalid_workspace_creation_title', max: config.limits.nameChars }),
    externalExportRequested: false
  };
  if (value.kind === 'spreadsheet') result.cells = normalizeCells(value.cells || []);
  else result.content = text(value.content, { code: 'invalid_workspace_creation_content', max: config.limits.contentChars });
  return result;
}

module.exports = { normalizeCreation, normalizeCells };
