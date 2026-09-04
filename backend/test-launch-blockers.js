'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const backendDir = __dirname;
const rootDir = path.resolve(backendDir, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8').replace(/^\uFEFF/, '');
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

const server = read('backend/server.js');
const gatekeeper = read('backend/gatekeeper.js');
const validation = read('backend/lib/inputValidation.js');
const worker = read('backend/worker.js');
const router = read('backend/aiRouter.js');
const models = JSON.parse(read('backend/config/models.json'));
const frontend = read('frontend/index.html');
const settlementSql = read('backend/16_settle_credit_charge.sql');

assert(
  server.includes("validateChatBody, loadRoxUserMiddleware, async"),
  'Free chat must load the profile without the positive-credit gate.'
);
assert(
  gatekeeper.includes('async function loadRoxUserMiddleware'),
  'The profile-loading middleware must exist.'
);
assert(
  validation.includes("'es', 'zh'"),
  'Chinese AI response preferences must be accepted by the backend.'
);
assert(
  worker.includes("const Replicate = require('replicate');") &&
    worker.includes('const replicate = new Replicate'),
  'The video worker must instantiate the Replicate client.'
);
assert(
  settlementSql.includes('create or replace function settle_credit_charge'),
  'The settle_credit_charge RPC migration must exist.'
);
assert.strictEqual(
  count(frontend, 'sandbox="allow-scripts allow-forms allow-modals allow-downloads"'),
  4,
  'Both mobile and desktop code-preview iframes must be sandboxed.'
);
assert.strictEqual(
  count(frontend, 'if (DEMO_ENABLED && email === DEMO_EMAIL && password === DEMO_PASSWORD)'),
  2,
  'Demo login must be gated in both interfaces.'
);
assert.strictEqual(
  count(router, "model: 'openrouter/free'"),
  2,
  'openrouter/free should appear once in each chat/code chain, not as a duplicate chat fallback.'
);
assert.deepStrictEqual(
  models.rates['openrouter/free'],
  { input: 0, output: 0 },
  'The free router must not be costed with the expensive default rate.'
);
assert.deepStrictEqual(
  models.rates['nvidia/nemotron-3-super-120b-a12b:free'],
  { input: 0, output: 0 },
  'The Nemotron free route must not be costed with the expensive default rate.'
);
assert(
  server.includes("requireProSubscription('image')") &&
    server.includes("requireProSubscription('video')") &&
    server.includes("planHasFeature(subscriptionPlan, 'code')") &&
    server.includes("code: 'code_requires_plan'"),
  'Plan-gated services must be enforced server-side.'
);

console.log('ROX AI launch-blocker regression checks passed.');
