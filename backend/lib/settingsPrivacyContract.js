'use strict';

const { config } = require('./finalProductRegistry');

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function normalizeSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_settings');
  const language = input.language || 'auto';
  if (language !== 'auto' && !config.supportedLocalesForValidation.includes(language)) fail('invalid_settings_language');
  const theme = input.theme || 'system';
  const responseLength = input.responseLength || 'balanced';
  if (!['system','dark','light'].includes(theme)) fail('invalid_settings_theme');
  if (!['concise','balanced','detailed'].includes(responseLength)) fail('invalid_response_length');
  return {
    language,
    theme,
    responseLength,
    memoryEnabled: input.memoryEnabled === true,
    trainingConsent: input.trainingConsent === true,
    marketingConsent: input.marketingConsent === true,
    voiceContinuousListening: false,
    visionContinuousCapture: false,
    externalDataSharing: false,
    dataExportRequested: false,
    accountDeletionRequested: false
  };
}
function normalizeDataRightsRequest(input) {
  if (!input || typeof input !== 'object' || !['export','delete'].includes(input.type)) fail('invalid_data_rights_request');
  if (input.confirmed !== true) fail('data_rights_confirmation_required');
  return { type: input.type, confirmed: true, state: 'pending', executed: false };
}
module.exports = { normalizeSettings, normalizeDataRightsRequest };
