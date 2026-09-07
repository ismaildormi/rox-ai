'use strict';

const { config, validateFinalProductConfig } = require('./finalProductRegistry');

function evaluateLaunchReadiness(evidence = {}) {
  validateFinalProductConfig();
  const blockers = [];
  for (const id of config.interfaceOrder) {
    if (config.interfaces[id].productionVerified !== true) blockers.push(`interface_not_production_verified:${id}`);
  }
  for (const [gate, passed] of Object.entries(config.qualityGates)) {
    if (passed !== true || evidence[gate] !== true) blockers.push(`quality_gate_failed:${gate}`);
  }
  for (const [platform, state] of Object.entries(config.platforms)) {
    if (state.buildReady !== true || evidence[`${platform}BuildVerified`] !== true) blockers.push(`platform_not_ready:${platform}`);
  }
  return {
    ready: false,
    closedBetaAllowed: false,
    customerBillingAllowed: false,
    publicLaunchAllowed: false,
    storeSubmissionAllowed: false,
    blockers: [...new Set(blockers)].sort()
  };
}

function assertLaunchAllowed() {
  const result = evaluateLaunchReadiness();
  const error = new Error('zuvyr_launch_blocked');
  error.code = 'zuvyr_launch_blocked';
  error.blockers = result.blockers;
  throw error;
}

module.exports = { evaluateLaunchReadiness, assertLaunchAllowed };
