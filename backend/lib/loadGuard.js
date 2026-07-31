// ROX AI — lib/loadGuard.js
//
// Different signal from lib/rateLimit.js on purpose. rateLimit.js caps
// ONE user. loadGuard.js measures GLOBAL demand (all users, per feature)
// so aiRouter.js can decide: "traffic is heavy right now, protect margin
// by trying the cheap models first" — even when every individual user is
// well within their own rate limit.
//
// Reuses the same Redis connection as the BullMQ queue (lib/queue.js) —
// no new infrastructure needed.

const { connection } = require('./queue');

const WINDOW_SECONDS = 60;

const THRESHOLDS = {
  elevated: Number(process.env.LOAD_ELEVATED_RPM || 200), // requests/min across all users
  high: Number(process.env.LOAD_HIGH_RPM || 500),
};

// Kill switch: set LOAD_THROTTLE_ENABLED=false in .env to disable
// margin-aware routing entirely and always use the default chain order
// (useful while tuning THRESHOLDS with real traffic before trusting it).
const ENABLED = process.env.LOAD_THROTTLE_ENABLED !== 'false';

function bucketKey(feature) {
  // Fixed 60s bucket that rotates every minute. Not a perfectly smooth
  // sliding window, but cheap (one INCR per request) and precise enough
  // to be a useful throttle signal.
  const bucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  return `load:${feature}:${bucket}`;
}

/**
 * Call once per incoming request (before or after the rate-limit check —
 * doesn't matter which, this just needs to see real demand).
 */
async function recordRequest(feature) {
  if (!ENABLED) return;
  const key = bucketKey(feature);
  const count = await connection.incr(key);
  if (count === 1) {
    await connection.expire(key, WINDOW_SECONDS * 2);
  }
}

/**
 * @returns {Promise<'normal'|'elevated'|'high'>}
 */
async function getLoadLevel(feature) {
  if (!ENABLED) return 'normal';
  const key = bucketKey(feature);
  const count = Number(await connection.get(key)) || 0;
  if (count >= THRESHOLDS.high) return 'high';
  if (count >= THRESHOLDS.elevated) return 'elevated';
  return 'normal';
}

module.exports = { recordRequest, getLoadLevel, THRESHOLDS, ENABLED };
