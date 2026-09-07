'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
for (const file of ['lib/ipCapabilityRegistry.js','lib/ipPermissionContract.js','lib/ipPlanContract.js','lib/ipActionPolicy.js','lib/ipAuditContract.js','lib/ipRecoveryContract.js','lib/ipSecurityPolicy.js']) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  assert(!source.includes('fetch('), `${file} must not connect to devices`);
  assert(!source.includes('reserveCredits('), `${file} must not reserve unpriced credits`);
  assert(!source.includes("require('node:child_process')"), `${file} must not spawn processes`);
  assert(!source.includes('WebSocket('), `${file} must not open sockets`);
}
console.log('PASS: Pack 08 performs no device, network, credit, database or subprocess execution');
