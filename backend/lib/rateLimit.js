// ROX AI — lib/rateLimit.js
// Nothing in the original backend capped how often one user could hit
// /api/chat or /api/generate-image. A single account (or a script with
// a stolen/valid session token) could flood the queue or rack up
// Anthropic/OpenRouter/Replicate spend before the credit system even
// has a chance to matter. Fixed-window counter per user, stored in the
// same Redis instance already used for BullMQ (lib/queue.js).

const { connection } = require('./queue');
const { plans } = require('../src/core/config');

const WINDOW_SECONDS = 60;
// Sourced from config/plans.json (rateLimitsPerMinute) instead of an
// inline object, so tuning a limit is a config edit — see
// ARCHITECTURE.md "Configuration strategy".
const MAX_REQUESTS = plans.rateLimitsPerMinute;

function rateLimit(kind) {
  const limit = MAX_REQUESTS[kind] || 10;

  return async function rateLimitMiddleware(req, res, next) {
    if (!req.userId) {
      // requireAuth must run before this; fail closed if it didn't.
      return res.status(500).json({ status: 'error', message: 'Rate limit requires auth to run first.' });
    }

    const key = `ratelimit:${kind}:${req.userId}`;
    const current = await connection.incr(key);
    if (current === 1) {
      await connection.expire(key, WINDOW_SECONDS);
    }

    if (current > limit) {
      const ttl = await connection.ttl(key);
      res.setHeader('Retry-After', ttl > 0 ? ttl : WINDOW_SECONDS);
      return res.status(429).json({
        status: 'error',
        message: 'Trop de requêtes — réessayez dans un instant.',
        retry_after_seconds: ttl,
      });
    }

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current));
    next();
  };
}

module.exports = { rateLimit };
