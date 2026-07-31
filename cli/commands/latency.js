// ROX AI — cli/commands/latency.js
//
// Measures actual round-trip time to the three kinds of external
// dependency this app has: Redis (queue + circuit breaker state),
// Supabase (every DB read/write), and each configured AI provider's
// base URL. Real timers around real calls — no synthetic/estimated
// numbers.
//
// Usage: rox latency

const { log, loadEnv } = require('../lib/util');
const { tryLoad, loadProviders, PROVIDER_ENV_VAR, PROVIDER_BASE_URL_VAR, DEFAULT_LOCAL_BASE_URL } = require('../lib/aiBackend');

const PROBE_URL = {
  anthropic: 'https://api.anthropic.com',
  openrouter: 'https://openrouter.ai/api/v1/models',
  openai: 'https://api.openai.com/v1/models',
  google: 'https://generativelanguage.googleapis.com',
  groq: 'https://api.groq.com',
};

async function timeIt(fn) {
  const start = process.hrtime.bigint();
  try {
    await fn();
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    return { ok: true, ms };
  } catch (err) {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    return { ok: false, ms, error: err.message };
  }
}

function report(label, result) {
  if (result.ok) log.ok(`${label}: ${result.ms.toFixed(0)}ms`);
  else log.err(`${label}: failed after ${result.ms.toFixed(0)}ms — ${result.error}`);
}

module.exports = async function latency() {
  log.step('ROX AI — latency');
  loadEnv();

  const redisResult = tryLoad('lib/queue');
  if (redisResult.ok) {
    const result = await timeIt(() => redisResult.module.connection.ping());
    report('Redis PING', result);
  } else {
    log.warn(`Redis: could not load lib/queue.js (${redisResult.error.message})`);
  }

  const supabaseResult = tryLoad('lib/supabaseAdmin');
  if (supabaseResult.ok) {
    const result = await timeIt(async () => {
      const { error } = await supabaseResult.module.supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).limit(1);
      if (error) throw new Error(error.message);
    });
    report('Supabase (profiles select)', result);
  } else {
    log.warn(`Supabase: could not load lib/supabaseAdmin.js (${supabaseResult.error.message})`);
  }

  console.log('');
  const providersResult = loadProviders();
  if (providersResult.ok) {
    for (const { key, label } of providersResult.module.listProviders()) {
      const url = key === 'local' ? (process.env[PROVIDER_BASE_URL_VAR.local] || DEFAULT_LOCAL_BASE_URL) : PROBE_URL[key];
      if (!url) continue;
      const envVar = PROVIDER_ENV_VAR[key];
      const headers = envVar && process.env[envVar] ? { authorization: `Bearer ${process.env[envVar]}` } : {};
      const result = await timeIt(async () => {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
        // A response at all (even a 401/404) means the round trip
        // completed — that's what latency means here, not "call
        // succeeded". Only network-level failures throw.
        void res;
      });
      report(`${label} (${key})`, result);
    }
  }
};
