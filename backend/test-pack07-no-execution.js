'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
for (const file of ['lib/audioStudioRoutes.js','lib/audioOperationRegistry.js','lib/audioRequestContract.js','lib/audioJobContract.js','lib/voiceSessionContract.js']) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  assert(!source.includes('fetch('), `${file} must not call providers`);
  assert(!source.includes('reserveCredits('), `${file} must not reserve before verified pricing`);
  assert(!source.includes("require('node:child_process')"), `${file} must not spawn processes`);
}
console.log('PASS: Pack 07 foundation performs no provider, credit, database or subprocess execution');
