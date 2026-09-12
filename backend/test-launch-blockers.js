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
const videoProvider = read('backend/lib/videoProvider.js');
const router = read('backend/aiRouter.js');
const models = JSON.parse(read('backend/config/models.json'));
const frontend = read('frontend/index.html');
const settlementSql = read('backend/16_settle_credit_charge.sql');
const securityCorrectionsSql = read('backend/42_zuvyr_supabase_security_corrections.sql');

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
  worker.includes("require('./lib/videoProvider')") &&
    videoProvider.includes("const Replicate = require('replicate');") &&
    videoProvider.includes('new Replicate({ auth: token })'),
  'The video worker must use the isolated Replicate video provider adapter.'
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

assert(
  securityCorrectionsSql.includes('alter table public.revenue_events enable row level security') &&
    securityCorrectionsSql.includes('alter table public.shared_conversations enable row level security'),
  'Pack 009 must keep revenue_events and shared_conversations behind RLS.'
);
assert(
  securityCorrectionsSql.includes('alter view public.credit_audit_mismatches') &&
    securityCorrectionsSql.includes('security_invoker = true'),
  'The credit audit mismatch view must remain SECURITY INVOKER.'
);
assert(
  securityCorrectionsSql.includes('from public, anon, authenticated') &&
    securityCorrectionsSql.includes('to service_role'),
  'Privileged Pack 009 database objects must preserve browser-role lockdown.'
);
assert(
  securityCorrectionsSql.includes('set search_path = pg_catalog, public, pg_temp'),
  'Privileged/internal database functions must use a fixed safe search_path.'
);
assert(
  securityCorrectionsSql.includes('alter default privileges for role postgres in schema public') &&
    !securityCorrectionsSql.includes('storage.'),
  'Public default privileges must be hardened without modifying managed storage defaults.'
);
assert(
  !/\bdrop\s+table\b/i.test(securityCorrectionsSql) &&
    !/\btruncate\b/i.test(securityCorrectionsSql) &&
    !/\bdelete\s+from\b/i.test(securityCorrectionsSql),
  'Pack 009 security migration must remain non-destructive.'
);

console.log('ROX AI launch-blocker regression checks passed.');
