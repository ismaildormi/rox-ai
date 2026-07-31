#!/usr/bin/env node
// ROX AI — test-hardening.js
//
// Standalone smoke test for the v3.3 hardening pass (lib/ipGuard.js,
// lib/inputValidation.js, server.js body-size cap). Hammers a RUNNING
// instance of server.js from the outside, over real HTTP — it does not
// import server.js or mock anything, so a pass here means the actual
// deployed behavior is correct, not just the unit logic.
//
// IMPORTANT — read before running:
//   1. Run this against a DEV/staging instance, not production. It
//      deliberately trips the IP-block guard, which will then block
//      YOUR OWN IP from reaching this instance for AUTH_FAIL_BLOCK_COOLDOWN_MIN
//      minutes (default 30) — real traffic from that IP would 429 too.
//   2. It needs its own REDIS_URL (same one server.js uses) to (a) print
//      the live counters as proof, and (b) clean up the keys it created
//      when the run finishes, so it doesn't leave your dev IP blocked.
//   3. What this script CANNOT verify without a real user: the
//      field-level checks in lib/inputValidation.js (message count,
//      per-message length) and gatekeeper.js's credit deduction both
//      run AFTER requireAuth — they need a real Supabase session token.
//      Set AUTH_TOKEN to also run that part; otherwise those two checks
//      are skipped with a clear note, not silently assumed to pass.
//
// Usage:
//   BASE_URL=http://localhost:3001 REDIS_URL=redis://localhost:6379 node test-hardening.js
//   AUTH_TOKEN=<supabase access_token> node test-hardening.js   # also runs the authenticated checks
//
// Requires: Node 18+ (global fetch), ioredis (already a project dependency)

const IORedis = require('ioredis');

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const AUTH_TOKEN = process.env.AUTH_TOKEN || null;

// Mirror server.js defaults so the script's expectations track .env.example
// even if you haven't overridden them.
const IP_RATE_LIMIT_RPM = Number(process.env.IP_RATE_LIMIT_RPM || 120);
const AUTH_FAIL_BLOCK_THRESHOLD = Number(process.env.AUTH_FAIL_BLOCK_THRESHOLD || 20);
const MAX_CHARS_PER_MESSAGE = Number(process.env.MAX_CHARS_PER_MESSAGE || 8000);

const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

const results = []; // { name, pass, detail }
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'} — ${name}${detail ? `  (${detail})` : ''}`);
}

async function safeFetch(path, opts) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, opts);
    return { status: res.status, body: await res.text().catch(() => '') };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

// --- Test 1: IP flood -> global rate limit ------------------------------
// Hits GET /metrics (no auth required, mounted before requireAuth) so
// this test only exercises lib/ipGuard.js's ipRateLimit(), without also
// tripping the auth-failure counter (kept as a separate test below, on
// its own counter, so the two don't contaminate each other's results).
async function testIpFlood() {
  console.log(`\n--- Test 1: IP flood simulation (GET /metrics x${IP_RATE_LIMIT_RPM + 20}) ---`);
  const total = IP_RATE_LIMIT_RPM + 20; // deliberately overshoot the limit
  const statusCounts = {};
  let firstBlockedAt = null;

  for (let i = 1; i <= total; i++) {
    const { status } = await safeFetch('/metrics');
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (status === 429 && firstBlockedAt === null) firstBlockedAt = i;
  }

  console.log('   status breakdown:', statusCounts);
  const gotBlocked = (statusCounts[429] || 0) > 0;
  record(
    'IP flood is rate-limited (429 after threshold)',
    gotBlocked,
    gotBlocked
      ? `first 429 at request #${firstBlockedAt} (limit=${IP_RATE_LIMIT_RPM}/min)`
      : `never got a 429 in ${total} requests — check IP_RATE_LIMIT_RPM / trust proxy / Redis connectivity`
  );
}

// --- Test 2: Auth stress -> credential-stuffing block -------------------
// Sends garbage bearer tokens to a real protected route. Expect a run of
// 401s (invalid token, correctly rejected) followed by 429s once
// AUTH_FAIL_BLOCK_THRESHOLD is crossed and the IP gets blocked outright.
async function testAuthStress() {
  console.log(`\n--- Test 2: Auth stress (POST /api/chat x${AUTH_FAIL_BLOCK_THRESHOLD + 10} with garbage tokens) ---`);
  const total = AUTH_FAIL_BLOCK_THRESHOLD + 10;
  const statusCounts = {};
  let firstBlockedAt = null;

  for (let i = 1; i <= total; i++) {
    const { status } = await safeFetch('/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer not-a-real-token-${i}`,
      },
      body: JSON.stringify({ feature: 'chat', messages: [{ role: 'user', content: 'ping' }] }),
    });
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (status === 429 && firstBlockedAt === null) firstBlockedAt = i;
  }

  console.log('   status breakdown:', statusCounts);
  const sawUnauthorized = (statusCounts[401] || 0) > 0;
  const gotBlocked = (statusCounts[429] || 0) > 0;
  record('Invalid tokens are rejected with 401', sawUnauthorized);
  record(
    'IP is blocked after repeated auth failures (429)',
    gotBlocked,
    gotBlocked
      ? `first 429 at request #${firstBlockedAt} (threshold=${AUTH_FAIL_BLOCK_THRESHOLD})`
      : 'never got a 429 — check AUTH_FAIL_BLOCK_THRESHOLD / Redis connectivity'
  );
}

// --- Test 3: Oversized payload -> rejected before it reaches any handler ---
async function testOversizedPayload() {
  console.log('\n--- Test 3: Oversized payload (> 32kb body) ---');
  const hugeContent = 'x'.repeat(60 * 1024); // ~60kb, well over the 32kb cap
  const { status, body } = await safeFetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' }, // no auth needed — should be rejected before requireAuth even runs
    body: JSON.stringify({ feature: 'chat', messages: [{ role: 'user', content: hugeContent }] }),
  });
  console.log(`   status=${status}`);
  // Express's body-parser returns 413 Payload Too Large for this. Some
  // proxies/hosts rewrite it, so also accept a 400 as a pass — the point
  // being verified is "not 200, and not reaching the model call".
  const rejected = status === 413 || status === 400;
  record('Oversized (>32kb) body is rejected, not processed', rejected, `status=${status}`);
}

// --- Test 4 (optional, needs AUTH_TOKEN): field-level validation --------
// lib/inputValidation.js runs AFTER requireAuth, so this can only be
// tested end-to-end with a real, valid session token — a garbage token
// (as used in Test 2) would just 401 before ever reaching validateChatBody.
async function testAuthenticatedValidation() {
  if (!AUTH_TOKEN) {
    console.log('\n--- Test 4: field-level validation (SKIPPED) ---');
    console.log('   AUTH_TOKEN not set — cannot reach validateChatBody without a real session token.');
    console.log('   Set AUTH_TOKEN=<a valid supabase access_token> to include this check.');
    return;
  }

  console.log('\n--- Test 4: field-level validation (authenticated) ---');
  const oversizedMessage = 'x'.repeat(MAX_CHARS_PER_MESSAGE + 500); // under 32kb total, over the per-message cap
  const { status, body } = await safeFetch('/api/chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify({ feature: 'chat', messages: [{ role: 'user', content: oversizedMessage }] }),
  });
  console.log(`   status=${status} body=${body.slice(0, 200)}`);
  record('Per-message length cap is enforced (400)', status === 400, `status=${status}`);
}

// --- Redis proof + cleanup -----------------------------------------------
// Shows the actual counters ipGuard.js wrote, as independent evidence
// beyond the HTTP status codes above — then deletes them so this run
// doesn't leave your own dev IP blocked for AUTH_FAIL_BLOCK_COOLDOWN_MIN.
async function inspectAndCleanupRedis() {
  console.log('\n--- Redis: keys this run created ---');
  const patterns = ['ipload:*', 'authfail:*', 'ipblocked:*'];
  let totalKeys = 0;

  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    for (const key of keys) {
      const val = await redis.get(key);
      const ttl = await redis.ttl(key);
      console.log(`   ${key} = ${val}  (ttl ${ttl}s)`);
      totalKeys++;
    }
  }

  if (totalKeys === 0) {
    console.log('   (none found — if you expected some, check REDIS_URL points at the same Redis as server.js)');
  }

  console.log('\n--- Cleaning up (so this run doesn\'t block your own dev IP) ---');
  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  }
  console.log(`   deleted ${totalKeys} key(s).`);
}

// --- credit_audit_log note -------------------------------------------
// None of the requests above ever reach gatekeeper.reserveCredits() —
// they're stopped by ipGuard/requireAuth/body-parser first, which is
// the entire point (a blocked request must never cost a credit). So
// credit_audit_log stays empty for all of this on purpose; the real
// evidence is the HTTP status codes above and the Redis keys printed
// here, not the SQL audit log.
function printAuditLogNote() {
  console.log('\n--- Note on credit_audit_log ---');
  console.log('   None of these requests will appear in credit_audit_log. That table');
  console.log('   only logs events that reached gatekeeper.reserveCredits() — i.e.');
  console.log('   requests that passed auth AND validation. A blocked/rejected request');
  console.log('   never charges a credit, so it never gets a ledger row, by design.');
  console.log('   The Redis counters above + the HTTP status codes are the correct');
  console.log('   evidence for "did the block actually happen".');
}

async function main() {
  console.log(`ROX AI — hardening smoke test`);
  console.log(`BASE_URL=${BASE_URL}  REDIS_URL=${REDIS_URL}  AUTH_TOKEN=${AUTH_TOKEN ? 'set' : 'not set'}\n`);

  await testIpFlood();
  await testAuthStress();
  await testOversizedPayload();
  await testAuthenticatedValidation();
  await inspectAndCleanupRedis();
  printAuditLogNote();

  const passed = results.filter(r => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  for (const r of results) {
    if (!r.pass) console.log(`   ❌ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }

  await redis.quit();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (err) => {
  console.error('test-hardening.js crashed:', err);
  await redis.quit().catch(() => {});
  process.exit(1);
});
