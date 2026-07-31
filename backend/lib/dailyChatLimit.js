// ROX AI — lib/dailyChatLimit.js
//
// Free-tier 'chat' is unmetered by credits (see server.js /api/chat) and
// served entirely by the free OpenRouter models (see aiRouter.js), so
// its real API cost is close to $0 regardless of volume. This daily cap
// is NOT a cost control — it's abuse protection: it stops a single free
// account (or a script hammering it with a valid session token) from
// generating unbounded request volume in one day. Pro users are exempt
// entirely (checked by the caller before this runs).
//
// Reuses the same Redis connection already used by BullMQ (lib/queue.js)
// and lib/rateLimit.js — no new infra.

const { connection } = require('./queue');

const FREE_DAILY_CHAT_LIMIT = Number(process.env.FREE_DAILY_CHAT_LIMIT || 150);
const WINDOW_SECONDS = 24 * 60 * 60;

async function checkAndIncrementDailyChat(userId) {
  const dayKey = new Date().toISOString().slice(0, 10); // resets naturally at UTC midnight
  const key = `dailychat:${userId}:${dayKey}`;

  const current = await connection.incr(key);
  if (current === 1) {
    await connection.expire(key, WINDOW_SECONDS);
  }

  return {
    allowed: current <= FREE_DAILY_CHAT_LIMIT,
    current,
    limit: FREE_DAILY_CHAT_LIMIT,
  };
}

// Read-only lookup for the frontend (page load / after sending a message)
// — does NOT increment, so just displaying the counter never counts
// against the user's daily quota.
async function peekDailyChat(userId) {
  const dayKey = new Date().toISOString().slice(0, 10);
  const key = `dailychat:${userId}:${dayKey}`;
  const raw = await connection.get(key);
  const current = raw ? Number(raw) : 0;
  return { current, limit: FREE_DAILY_CHAT_LIMIT };
}

module.exports = { checkAndIncrementDailyChat, peekDailyChat, FREE_DAILY_CHAT_LIMIT };
