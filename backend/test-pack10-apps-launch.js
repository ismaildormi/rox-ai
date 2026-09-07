'use strict';
const assert = require('node:assert/strict');
const { normalizeAppCandidate } = require('./lib/appReadinessContract');
const { evaluateLaunchReadiness, assertLaunchAllowed } = require('./lib/launchReadinessGate');
for (const platform of ['web','windows','android','ios']) {
  const candidate = normalizeAppCandidate({ platform, version: '1.0.0', checks: {} });
  assert.equal(candidate.buildReady, false);
  assert.equal(candidate.storeSubmissionAllowed, false);
  assert(candidate.missingChecks.length > 0);
}
const launch = evaluateLaunchReadiness(Object.fromEntries(Array(50).fill(0).map((_, index) => [`fake${index}`, true])));
assert.equal(launch.ready, false);
assert.equal(launch.customerBillingAllowed, false);
assert.equal(launch.publicLaunchAllowed, false);
assert(launch.blockers.some(item => item.startsWith('interface_not_production_verified:')));
assert(launch.blockers.some(item => item.startsWith('quality_gate_failed:')));
assert.throws(() => assertLaunchAllowed(), /zuvyr_launch_blocked/);
console.log('PASS: Pack 10 Web/Windows/Android/iOS and Beta/Billing/Public Launch remain evidence-gated');
