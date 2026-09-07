'use strict';

const { config, ipError } = require('./ipCapabilityRegistry');

const BLOCKED_TARGETS = [/(^|[\\/])\.ssh([\\/]|$)/i, /(^|[\\/])\.aws([\\/]|$)/i, /(^|[\\/])\.env(?:\.|$)/i, /credentials?/i, /service[-_]?account/i, /private[-_]?key/i];

function inspectIpActionSecurity(action) {
  const combined = `${action?.target || ''}\n${action?.input || ''}`;
  if (BLOCKED_TARGETS.some(pattern => pattern.test(combined))) throw ipError('ip_sensitive_target_blocked');
  return Object.freeze({ sandboxConfigured: config.execution.sandboxConfigured, networkEnabled: false, secretsAvailable: false, safeForExecution: false });
}

module.exports = { inspectIpActionSecurity };
