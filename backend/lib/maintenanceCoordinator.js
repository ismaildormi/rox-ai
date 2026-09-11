'use strict';

const crypto = require('crypto');

const STRATEGY = 'railway_internal_route';
const LOCK_KEY = 'zuvyr:maintenance:lock';
const LAST_RECEIPT_KEY = 'zuvyr:maintenance:last';
const WINDOW_MS = 30 * 60 * 1000;
const LOCK_TTL_MS = 5 * 60 * 1000;
const RECEIPT_TTL_SECONDS = 30 * 24 * 60 * 60;
const SUCCESS_TTL_SECONDS = 24 * 60 * 60;

function maintenanceWindowKey(nowMs = Date.now()) {
  return `zuvyr:maintenance:success:${Math.floor(nowMs / WINDOW_MS)}`;
}

function safeError(error) {
  if (!error) return null;
  return String(error.message || error).slice(0, 500);
}

async function writeReceipt(redis, receipt) {
  const serialized = JSON.stringify(receipt);
  await redis.set(
    `zuvyr:maintenance:receipt:${receipt.runId}`,
    serialized,
    'EX',
    RECEIPT_TTL_SECONDS
  );
  await redis.set(
    LAST_RECEIPT_KEY,
    serialized,
    'EX',
    RECEIPT_TTL_SECONDS
  );
}

async function releaseLock(redis, token) {
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    end
    return 0
  `;
  try {
    await redis.eval(script, 1, LOCK_KEY, token);
  } catch (error) {
    console.error('[maintenance] lock release failed:', safeError(error));
  }
}

async function runMaintenanceOnce({
  redis,
  supabaseAdmin,
  nowMs = Date.now(),
  logger = console,
}) {
  if (!redis || typeof redis.set !== 'function') {
    const error = new Error('maintenance Redis dependency unavailable');
    error.code = 'maintenance_redis_unavailable';
    throw error;
  }
  if (!supabaseAdmin || typeof supabaseAdmin.rpc !== 'function') {
    const error = new Error('maintenance Supabase dependency unavailable');
    error.code = 'maintenance_supabase_unavailable';
    throw error;
  }

  const windowKey = maintenanceWindowKey(nowMs);
  const priorRunId = await redis.get(windowKey);
  if (priorRunId) {
    const priorRaw = await redis.get(`zuvyr:maintenance:receipt:${priorRunId}`);
    return {
      status: 'duplicate_suppressed',
      duplicate: true,
      receipt: priorRaw ? JSON.parse(priorRaw) : { runId: priorRunId },
    };
  }

  const runId = crypto.randomUUID();
  const lockToken = crypto.randomUUID();
  const locked = await redis.set(LOCK_KEY, lockToken, 'PX', LOCK_TTL_MS, 'NX');

  if (locked !== 'OK') {
    const lastRaw = await redis.get(LAST_RECEIPT_KEY);
    return {
      status: 'already_running',
      duplicate: true,
      receipt: lastRaw ? JSON.parse(lastRaw) : null,
    };
  }

  const receipt = {
    runId,
    strategy: STRATEGY,
    windowKey,
    status: 'running',
    startedAt: new Date(nowMs).toISOString(),
    finishedAt: null,
    newAlertsRaised: null,
    accountsReset: null,
    errors: [],
  };

  try {
    await writeReceipt(redis, receipt);

    const mismatch = await supabaseAdmin.rpc('check_credit_audit_mismatches');
    if (mismatch.error) {
      receipt.errors.push({
        step: 'check_credit_audit_mismatches',
        message: safeError(mismatch.error),
      });
      logger.error(
        '[maintenance] check_credit_audit_mismatches failed:',
        safeError(mismatch.error)
      );
    } else {
      receipt.newAlertsRaised = mismatch.data ?? 0;
    }

    const reset = await supabaseAdmin.rpc('reset_monthly_credits');
    if (reset.error) {
      receipt.errors.push({
        step: 'reset_monthly_credits',
        message: safeError(reset.error),
      });
      logger.error(
        '[maintenance] reset_monthly_credits failed:',
        safeError(reset.error)
      );
    } else {
      receipt.accountsReset = reset.data ?? 0;
    }

    receipt.finishedAt = new Date().toISOString();

    if (receipt.errors.length === 0) {
      receipt.status = 'success';
      await writeReceipt(redis, receipt);
      await redis.set(windowKey, runId, 'EX', SUCCESS_TTL_SECONDS, 'NX');
      logger.log('[maintenance] success', JSON.stringify({
        runId,
        newAlertsRaised: receipt.newAlertsRaised,
        accountsReset: receipt.accountsReset,
      }));
      return { status: 'success', duplicate: false, receipt };
    }

    const successfulSteps = [
      receipt.newAlertsRaised !== null,
      receipt.accountsReset !== null,
    ].filter(Boolean).length;
    receipt.status = successfulSteps > 0 ? 'partial' : 'failed';
    await writeReceipt(redis, receipt);
    return { status: receipt.status, duplicate: false, receipt };
  } catch (error) {
    receipt.status = 'failed';
    receipt.finishedAt = new Date().toISOString();
    receipt.errors.push({ step: 'coordinator', message: safeError(error) });
    try {
      await writeReceipt(redis, receipt);
    } catch (receiptError) {
      logger.error('[maintenance] failure receipt write failed:', safeError(receiptError));
    }
    throw error;
  } finally {
    await releaseLock(redis, lockToken);
  }
}

function requireMaintenanceStrategy(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.MAINTENANCE_STRATEGY !== STRATEGY) {
    return res.status(503).json({
      status: 'error',
      code: 'maintenance_strategy_disabled',
      message: 'Maintenance scheduling is not activated.',
    });
  }
  return next();
}

module.exports = {
  STRATEGY,
  LOCK_KEY,
  maintenanceWindowKey,
  runMaintenanceOnce,
  requireMaintenanceStrategy,
};
