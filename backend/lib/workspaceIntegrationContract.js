'use strict';

const crypto = require('node:crypto');
const { config } = require('./workspaceCapabilityRegistry');
const { object, text, uniqueStrings, fail } = require('./workspaceValidation');

function stableDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeIntegrationRequest(input) {
  const value = object(input, 'invalid_workspace_integration');
  if (!['google_drive', 'plugins'].includes(value.integration)) fail('unsupported_workspace_integration');
  const policy = config.integrations[value.integration];
  const scopes = uniqueStrings(value.scopes, { code: 'invalid_workspace_integration_scopes', allowed: policy.allowedScopes, max: config.limits.permissionScopes });
  if (value.explicitConsent !== true) fail('workspace_integration_consent_required');
  const request = {
    integration: value.integration,
    displayName: text(value.displayName, { code: 'invalid_workspace_integration_name', max: config.limits.nameChars }),
    scopes,
    explicitConsent: true,
    externalWriteRequested: scopes.some(scope => /\.write$|export/.test(scope)),
    enabled: false,
    status: policy.status
  };
  request.confirmationRequired = request.externalWriteRequested;
  request.requestDigest = stableDigest(request);
  return request;
}

function assertNoCredentialMaterial(input) {
  const serialized = JSON.stringify(object(input, 'invalid_workspace_integration'));
  if (/(?:access|refresh|oauth|api)[_-]?token|client[_-]?secret|authorization|cookie|password/i.test(serialized)) fail('workspace_credential_material_blocked');
  return true;
}

module.exports = { normalizeIntegrationRequest, assertNoCredentialMaterial, stableDigest };
