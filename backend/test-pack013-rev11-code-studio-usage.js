'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CODE_USAGE_KINDS,
  usageKindForOperation,
  createCodeStudioUsageBridge
} = require('./lib/codeStudioUsageBridge');

assert.deepEqual(CODE_USAGE_KINDS, [
  'ai_code_edit',
  'build_job',
  'sandbox_runtime',
  'preview_runtime',
  'preview_egress',
  'idle_session'
]);

assert.equal(usageKindForOperation('build'), 'build_job');
for (const operation of ['run', 'terminal', 'dependencies', 'test']) {
  assert.equal(usageKindForOperation(operation), 'sandbox_runtime');
}
assert.throws(() => usageKindForOperation('deploy'), { code: 'unmetered_code_runtime_operation' });

const calls = [];
const bridge = createCodeStudioUsageBridge({
  async reserveCredits(input) {
    calls.push(['reserve', input]);
    return { newBalance: 9, replayed: false };
  },
  async settleCredits(requestId, finalCredits) {
    calls.push(['settle', requestId, finalCredits]);
    return { ok: true };
  },
  async refundCredits(requestId) {
    calls.push(['refund', requestId]);
    return { ok: true };
  }
});

(async () => {
  await bridge.reserveUsage({
    userId: 'user-1',
    requestId: 'code:req:1',
    projectId: 'project-1',
    taskId: 'task-1',
    stepId: 'build-1',
    operation: 'build',
    creditsConsumed: 3,
    pricingVersion: 'pack-014.single-cost-registry.v1'
  });

  const reservation = calls[0][1];
  assert.equal(reservation.feature, 'code');
  assert.equal(reservation.usageKind, 'build_job');
  assert.equal(reservation.projectId, 'project-1');
  assert.equal(reservation.taskId, 'task-1');
  assert.equal(reservation.stepId, 'build-1');
  assert.equal(reservation.pricingVersion, 'pack-014.single-cost-registry.v1');
  assert.equal(reservation.creditsConsumed, 3);

  await bridge.settleUsage('code:req:1', 2);
  await bridge.refundUsage('code:req:2');
  assert.deepEqual(calls[1], ['settle', 'code:req:1', 2]);
  assert.deepEqual(calls[2], ['refund', 'code:req:2']);

  await assert.rejects(
    bridge.reserveUsage({
      userId: 'u',
      requestId: 'r',
      usageKind: 'preview_runtime',
      creditsConsumed: 0
    }),
    { code: 'invalid_code_usage_reserved_credits' }
  );

  const gatekeeper = fs.readFileSync(path.join(__dirname, 'gatekeeper.js'), 'utf8');
  const router = fs.readFileSync(path.join(__dirname, 'lib/codeStudioRoutes.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const registry = fs.readFileSync(path.join(__dirname, 'config/cost-registry.v1.json'), 'utf8');

  assert(gatekeeper.includes('pricing_version: pricingVersion'));
  for (const marker of ['project_id:', 'task_id:', 'step_id:', 'usage_kind:']) {
    assert(gatekeeper.includes(marker));
  }

  assert(router.includes('createCodeStudioUsageBridge'));
  assert(router.includes('code_usage_ledger_unavailable'));
  assert(server.includes('createCodeStudioRouter({ creditApi: { reserveCredits, settleCredits, refundCredits } })'));

  for (const kind of ['build_job', 'sandbox_runtime', 'preview_runtime', 'preview_egress', 'idle_session']) {
    assert(registry.includes('"operationType": "' + kind + '"'));
  }

  console.log('PASS: Pack 013 Rev1.1 Code Studio usage bridge carries project/task/step/usage kind/pricing version through the existing idempotent credit path');
  console.log('PASS: build and sandbox runtime map to normalized usage kinds; preview/egress/idle contracts remain explicit and uncharged until a verified executor emits them');
  console.log('DATABASE / PROVIDER / PAYMENT / NETWORK CALLS: NONE');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
