'use strict';

const { config } = require('./workspaceCapabilityRegistry');
const { object, text, uniqueStrings, fail } = require('./workspaceValidation');

function normalizeTemplate(input) {
  const value = object(input, 'invalid_workspace_template');
  const body = text(value.body, { code: 'invalid_workspace_template_body', max: config.limits.contentChars });
  if (/<script\b|javascript:|on(?:load|error|click)\s*=|\beval\s*\(/i.test(body)) fail('workspace_template_script_blocked');
  const variables = value.variables === undefined ? [] : uniqueStrings(value.variables, {
    code: 'invalid_workspace_template_variables',
    max: config.limits.templateVariables
  });
  for (const variable of variables) if (!/^[a-z][a-z0-9_]{0,63}$/i.test(variable)) fail('invalid_workspace_template_variable');
  return {
    name: text(value.name, { code: 'invalid_workspace_template_name', max: config.limits.nameChars }),
    category: text(value.category, { code: 'invalid_workspace_template_category', max: 60 }),
    body,
    variables,
    scriptsAllowed: false,
    communityPublished: false
  };
}

module.exports = { normalizeTemplate };
