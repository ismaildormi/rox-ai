#!/usr/bin/env node
// ROX AI — backend/test-gatekeeper-unit.js
//
// Unit tests for gatekeeper.js — the credit reservation/refund logic
// flagged in the audit as the highest-risk untested surface ("business-
// critical financial logic... currently has no automated test coverage
// found"). Unlike test-hardening.js (a live-instance HTTP smoke test),
// this mocks lib/supabaseAdmin.js entirely, so it needs no real
// Supabase project, no network, and no `@supabase/supabase-js` install
// — it swaps the require.cache entry for lib/supabaseAdmin.js with a
// stub BEFORE gatekeeper.js is required, so gatekeeper.js's own
// `require('./lib/supabaseAdmin')` picks up the stub and never touches
// the real package.
//
// Run: node test-gatekeeper-unit.js

const assert = require('assert');
const Module = require('module');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err.stack || err}`);
    failed++;
    process.exitCode = 1;
  }
}

/**
 * Loads gatekeeper.js with lib/supabaseAdmin.js swapped for a mock
 * whose .from(...).select(...).eq(...).single() and .rpc(...) calls
 * return whatever the test configures.
 */
function loadGatekeeperWithMockSupabase({ profileResult, rpcResults = {} }) {
  const supabaseAdminPath = require.resolve('./lib/supabaseAdmin');
  const gatekeeperPath = require.resolve('./gatekeeper');

  const rpcCalls = [];
  const mockSupabaseAdmin = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async single() {
                  return profileResult; // { data, error }
                },
              };
            },
          };
        },
      };
    },
    async rpc(fnName, params) {
      rpcCalls.push({ fnName, params });
      const handler = rpcResults[fnName];
      if (!handler) {
        throw new Error(`test did not configure an rpc mock for "${fnName}"`);
      }
      return typeof handler === 'function' ? handler(params) : handler;
    },
  };

  const previousEntry = require.cache[supabaseAdminPath];
  const mockEntry = new Module(supabaseAdminPath);
  mockEntry.exports = { supabaseAdmin: mockSupabaseAdmin };
  mockEntry.loaded = true;
  require.cache[supabaseAdminPath] = mockEntry;

  delete require.cache[gatekeeperPath];
  let gatekeeper;
  try {
    gatekeeper = require(gatekeeperPath);
  } finally {
    if (previousEntry) require.cache[supabaseAdminPath] = previousEntry;
    else delete require.cache[supabaseAdminPath];
    delete require.cache[gatekeeperPath];
  }

  return { gatekeeper, rpcCalls };
}

async function main() {
  console.log('gatekeeper.js unit tests (mocked Supabase)');

  // --- checkAccess ---------------------------------------------------------

  await test('checkAccess: unknown user -> not allowed, reason user_not_found', async () => {
    const { gatekeeper } = loadGatekeeperWithMockSupabase({
      profileResult: { data: null, error: { message: 'no rows' } },
    });
    const result = await gatekeeper.checkAccess('missing-user');
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'user_not_found');
  });

  await test('checkAccess: credits remaining -> allowed, correct remaining balance', async () => {
    const { gatekeeper } = loadGatekeeperWithMockSupabase({
      profileResult: { data: { subscription_status: 'free', credits_total: 100, credits_used: 40 }, error: null },
    });
    const result = await gatekeeper.checkAccess('user-1');
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.remaining, 60);
  });

  await test('checkAccess: credits fully used -> not allowed, reason out_of_credits', async () => {
    const { gatekeeper } = loadGatekeeperWithMockSupabase({
      profileResult: { data: { subscription_status: 'free', credits_total: 100, credits_used: 100 }, error: null },
    });
    const result = await gatekeeper.checkAccess('user-2');
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'out_of_credits');
  });

  await test('checkAccess: Pro is not an unconditional bypass — still blocked at 0 remaining', async () => {
    const { gatekeeper } = loadGatekeeperWithMockSupabase({
      profileResult: { data: { subscription_status: 'pro', credits_total: 500, credits_used: 500 }, error: null },
    });
    const result = await gatekeeper.checkAccess('pro-user');
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'out_of_credits');
  });

  // --- reserveCredits --------------------------------------------------------

  await test('reserveCredits: rejects without a requestId (idempotency requirement)', async () => {
    const { gatekeeper } = loadGatekeeperWithMockSupabase({ profileResult: { data: null, error: null } });
    await assert.rejects(
      gatekeeper.reserveCredits({ userId: 'u', feature: 'chat' }),
      /requestId/
    );
  });

  await test('reserveCredits: success path returns newBalance and replayed=false', async () => {
    const { gatekeeper, rpcCalls } = loadGatekeeperWithMockSupabase({
      profileResult: { data: null, error: null },
      rpcResults: {
        deduct_credit_and_log: { data: { success: true, new_balance: 59, replayed: false }, error: null },
      },
    });
    const result = await gatekeeper.reserveCredits({ userId: 'u1', requestId: 'req-1', feature: 'chat', creditsConsumed: 1 });
    assert.strictEqual(result.newBalance, 59);
    assert.strictEqual(result.replayed, false);
    assert.strictEqual(rpcCalls[0].fnName, 'deduct_credit_and_log');
    assert.strictEqual(rpcCalls[0].params.p_request_id, 'req-1');
  });

  await test('reserveCredits: idempotent replay returns replayed=true instead of double-charging', async () => {
    const { gatekeeper } = loadGatekeeperWithMockSupabase({
      profileResult: { data: null, error: null },
      rpcResults: {
        deduct_credit_and_log: { data: { success: true, new_balance: 59, replayed: true }, error: null },
      },
    });
    const result = await gatekeeper.reserveCredits({ userId: 'u1', requestId: 'req-1', feature: 'chat' });
    assert.strictEqual(result.replayed, true);
  });

  await test('reserveCredits: insufficient credits rejects with code + available/required', async () => {
    const { gatekeeper } = loadGatekeeperWithMockSupabase({
      profileResult: { data: null, error: null },
      rpcResults: {
        deduct_credit_and_log: { data: { success: false, error: 'insufficient_credits', available: 0, required: 1 }, error: null },
      },
    });
    await assert.rejects(
      gatekeeper.reserveCredits({ userId: 'u2', requestId: 'req-2', feature: 'chat' }),
      (err) => {
        assert.strictEqual(err.code, 'insufficient_credits');
        assert.strictEqual(err.available, 0);
        assert.strictEqual(err.required, 1);
        return true;
      }
    );
  });

  await test('reserveCredits: propagates a raw Supabase/RPC error', async () => {
    const { gatekeeper } = loadGatekeeperWithMockSupabase({
      profileResult: { data: null, error: null },
      rpcResults: {
        deduct_credit_and_log: { data: null, error: new Error('connection reset') },
      },
    });
    await assert.rejects(
      gatekeeper.reserveCredits({ userId: 'u3', requestId: 'req-3', feature: 'chat' }),
      /connection reset/
    );
  });

  // --- refundCredits ----------------------------------------------------------

  await test('refundCredits: success returns newBalance, alreadyRefunded=false', async () => {
    const { gatekeeper, rpcCalls } = loadGatekeeperWithMockSupabase({
      profileResult: { data: null, error: null },
      rpcResults: {
        refund_credit_and_log: { data: { success: true, new_balance: 60, already_refunded: false }, error: null },
      },
    });
    const result = await gatekeeper.refundCredits('req-1');
    assert.strictEqual(result.newBalance, 60);
    assert.strictEqual(result.alreadyRefunded, false);
    assert.strictEqual(rpcCalls[0].params.p_request_id, 'req-1');
  });

  await test('refundCredits: calling twice for the same requestId reports alreadyRefunded, never double-refunds', async () => {
    const { gatekeeper } = loadGatekeeperWithMockSupabase({
      profileResult: { data: null, error: null },
      rpcResults: {
        refund_credit_and_log: { data: { success: true, new_balance: 60, already_refunded: true }, error: null },
      },
    });
    const result = await gatekeeper.refundCredits('req-1');
    assert.strictEqual(result.alreadyRefunded, true);
  });

  await test('refundCredits: unknown requestId surfaces the error code from the RPC', async () => {
    const { gatekeeper } = loadGatekeeperWithMockSupabase({
      profileResult: { data: null, error: null },
      rpcResults: {
        refund_credit_and_log: { data: { success: false, error: 'request_not_found' }, error: null },
      },
    });
    await assert.rejects(gatekeeper.refundCredits('unknown-req'), (err) => {
      assert.strictEqual(err.code, 'request_not_found');
      return true;
    });
  });

  // --- logCreditEvent (never charges, never throws to the caller) -------------

  await test('logCreditEvent: sends p_credits_consumed=0 (logging only, never charges)', async () => {
    const { gatekeeper, rpcCalls } = loadGatekeeperWithMockSupabase({
      profileResult: { data: null, error: null },
      rpcResults: {
        deduct_credit_and_log: { data: { success: true, new_balance: 60 }, error: null },
      },
    });
    await gatekeeper.logCreditEvent({ userId: 'u1', feature: 'chat', status: 'blocked' });
    assert.strictEqual(rpcCalls[0].params.p_credits_consumed, 0);
  });

  await test('logCreditEvent: swallows RPC errors instead of throwing (logging must never break the request)', async () => {
    const { gatekeeper } = loadGatekeeperWithMockSupabase({
      profileResult: { data: null, error: null },
      rpcResults: {
        deduct_credit_and_log: { data: null, error: new Error('db down') },
      },
    });
    await assert.doesNotReject(gatekeeper.logCreditEvent({ userId: 'u1', feature: 'chat', status: 'error' }));
  });

  console.log(`\n${passed} test(s) passed, ${failed} failed.`);
  if (failed > 0) {
    console.error('Some tests FAILED.');
  } else {
    console.log('All gatekeeper unit tests passed.');
  }
}

main();
