'use strict';

const { config } = require('./finalProductRegistry');

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function normalizeAppCandidate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_app_candidate');
  if (!Object.hasOwn(config.platforms, input.platform)) fail('invalid_app_platform');
  if (typeof input.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input.version)) fail('invalid_app_version');
  const checks = input.checks && typeof input.checks === 'object' && !Array.isArray(input.checks) ? input.checks : {};
  const required = ['signedBuild','privacyDisclosure','accountDeletion','permissionsReviewed','crashFreeTest','productionApiTest'];
  const missing = required.filter(check => checks[check] !== true);
  return { platform: input.platform, version: input.version, requiredChecks: required, missingChecks: missing, buildReady: false, storeSubmissionAllowed: false };
}
module.exports = { normalizeAppCandidate };
