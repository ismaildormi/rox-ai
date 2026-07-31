// ROX AI — lib/ipGuard.js
//
// Everything before this file protected against ONE compromised/valid
// account being abusive (lib/rateLimit.js, per-user). It did nothing
// against an attacker who just mints many accounts, or who is hammering
// requireAuth with stolen/guessed tokens — those show up as many
// different userIds (or none at all, pre-auth), so a per-user counter
// never sees them as related.
//
// This file adds two IP-based defenses on top:
//   1. A global per-IP request cap, regardless of which/how many
//      accounts that IP is using — blunts distributed spam from one
//      source.
//   2. An auth-failure counter: too many invalid/expired tokens from one
//      IP in a short window gets that IP temporarily blocked, before it
//      can burn through a credential-stuffing / token-guessing list.
//
// Neither of these makes the system "unhackable" — no rate limiter does.
// They raise the cost of automated abuse significantly and buy time to
// react (system_alerts / metrics) before it becomes expensive.

const { connection } = require('./queue');

const WINDOW_SECONDS = 60;
const IP_RATE_LIMIT_RPM = Number(process.env.IP_RATE_LIMIT_RPM || 120);

const AUTH_FAIL_THRESHOLD = Number(process.env.AUTH_FAIL_BLOCK_THRESHOLD || 20);
const AUTH_FAIL_WINDOW_SECONDS = Number(process.env.AUTH_FAIL_BLOCK_WINDOW_MIN || 10) * 60;
const AUTH_FAIL_COOLDOWN_SECONDS = Number(process.env.AUTH_FAIL_BLOCK_COOLDOWN_MIN || 30) * 60;

// req.ip is only trustworthy if the app trusts the reverse proxy in
// front of it (Railway/Render/etc set X-Forwarded-For) — see
// `app.set('trust proxy', 1)` in server.js. Falls back to the raw
// socket address if that's ever misconfigured, rather than throwing.
function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Global per-IP request cap, independent of login state or per-user
 * limits. Mount this BEFORE requireAuth on any route worth protecting —
 * it should reject floods before they even reach a DB/auth call.
 */
function ipRateLimit() {
  return async function ipRateLimitMiddleware(req, res, next) {
    const ip = clientIp(req);
    const bucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
    const key = `ipload:${ip}:${bucket}`;

    const count = await connection.incr(key);
    if (count === 1) {
      await connection.expire(key, WINDOW_SECONDS * 2);
    }

    if (count > IP_RATE_LIMIT_RPM) {
      return res.status(429).json({
        status: 'error',
        message: 'Trop de requêtes depuis cette adresse — réessayez plus tard.',
      });
    }
    next();
  };
}

/**
 * Blocks an IP outright if it's tripped the auth-failure threshold.
 * Mount BEFORE requireAuth so a blocked IP never even reaches the
 * Supabase token-verification call.
 */
async function ipBlockGuard(req, res, next) {
  const ip = clientIp(req);
  const blocked = await connection.get(`ipblocked:${ip}`);
  if (blocked) {
    return res.status(429).json({
      status: 'error',
      message: 'Adresse temporairement bloquée suite à trop de tentatives invalides.',
    });
  }
  next();
}

/**
 * Call from lib/auth.js whenever token verification fails. Cheap fixed
 * window: AUTH_FAIL_THRESHOLD invalid attempts within AUTH_FAIL_WINDOW
 * trips a cooldown block on that IP.
 */
async function recordAuthFailure(req) {
  const ip = clientIp(req);
  const key = `authfail:${ip}`;
  const count = await connection.incr(key);
  if (count === 1) {
    await connection.expire(key, AUTH_FAIL_WINDOW_SECONDS);
  }
  if (count >= AUTH_FAIL_THRESHOLD) {
    await connection.set(`ipblocked:${ip}`, '1', 'EX', AUTH_FAIL_COOLDOWN_SECONDS);
  }
}

/** Call from lib/auth.js on a SUCCESSFUL auth, to stop counting a since-fixed client. */
async function clearAuthFailures(req) {
  const ip = clientIp(req);
  await connection.del(`authfail:${ip}`);
}

module.exports = { clientIp, ipRateLimit, ipBlockGuard, recordAuthFailure, clearAuthFailures };
