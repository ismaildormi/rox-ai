// ROX AI — lib/modelHealth.js
// Wraps the circuit_check / circuit_report RPCs (07_model_health.sql)
// so aiRouter.js can skip a model it already knows is down instead of
// waiting out PRIMARY_TIMEOUT_MS on every single request. Postgres is
// the source of truth (shared across every server replica); Redis just
// caches the common "closed" case for a few seconds to avoid hitting
// the DB on every model attempt.

const { connection } = require('./queue');
const { supabaseAdmin } = require('./supabaseAdmin');

const CLOSED_CACHE_TTL_SECONDS = 5;

function cacheKey(model) {
  return `circuit:${model}`;
}

/**
 * Call before attempting a model.
 * @returns {Promise<{allowed: boolean, isProbe: boolean}>}
 */
async function canRoute(model) {
  const cached = await connection.get(cacheKey(model));
  if (cached === 'closed') {
    return { allowed: true, isProbe: false };
  }

  const { data, error } = await supabaseAdmin.rpc('circuit_check', { p_model: model });
  if (error) {
    // If the health check itself fails, fail open rather than blocking
    // all traffic on an observability bug — worst case we retry a dead
    // model occasionally, which is the old (safe) behavior anyway.
    console.error('[modelHealth] circuit_check failed, failing open:', error.message);
    return { allowed: true, isProbe: false };
  }

  if (data.allowed && !data.is_probe) {
    await connection.set(cacheKey(model), 'closed', 'EX', CLOSED_CACHE_TTL_SECONDS);
  }

  return { allowed: data.allowed, isProbe: data.is_probe };
}

/**
 * Call after attempting a model, with the outcome.
 */
async function reportOutcome(model, success) {
  if (success) {
    await connection.set(cacheKey(model), 'closed', 'EX', CLOSED_CACHE_TTL_SECONDS);
  } else {
    await connection.del(cacheKey(model)); // force the next call to re-check Postgres
  }

  const { error } = await supabaseAdmin.rpc('circuit_report', { p_model: model, p_success: success });
  if (error) {
    console.error('[modelHealth] circuit_report failed:', error.message);
  }
}

module.exports = { canRoute, reportOutcome };
