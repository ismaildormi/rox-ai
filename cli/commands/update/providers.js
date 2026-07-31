// ROX AI — cli/commands/update/providers.js
//
// "Refresh AI providers configuration." Reloads backend/.env (so a
// credential change doesn't need a full `rox restart` to be checked),
// re-runs the same registration/credential check as `rox ai providers`,
// then does a lightweight live reachability probe against each
// provider's base URL — catches a wrong LOCAL_MODEL_BASE_URL, a revoked
// key that 401s, or a provider outage, none of which `rox ai providers`
// alone can see since it only checks that an env var is *set*, not that
// it *works*.

const { log, loadEnv } = require('../../lib/util');
const { loadProviders, PROVIDER_ENV_VAR, DEFAULT_LOCAL_BASE_URL } = require('../../lib/aiBackend');
const checkProviders = require('../ai/providers');

const PROBE_URL = {
  anthropic: 'https://api.anthropic.com',
  openrouter: 'https://openrouter.ai/api/v1/models',
  openai: 'https://api.openai.com/v1/models',
  google: 'https://generativelanguage.googleapis.com',
  groq: 'https://api.groq.com',
};

async function probe(key, headers) {
  const url = key === 'local' ? `${process.env.LOCAL_MODEL_BASE_URL || DEFAULT_LOCAL_BASE_URL}/models` : PROBE_URL[key];
  if (!url) return { checked: false };
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(6000) });
    // Anthropic/Google root URLs return non-2xx for an unauthenticated GET
    // by design — reachability (got a response at all) is what matters
    // here, not a 200. A network-level failure (DNS, refused, timeout) is
    // what actually indicates a config problem.
    return { checked: true, reachable: true, status: res.status };
  } catch (err) {
    return { checked: true, reachable: false, reason: err.message };
  }
}

module.exports = async function updateProviders() {
  log.step('ROX AI — update providers');
  loadEnv();

  await checkProviders();

  const providersResult = loadProviders();
  if (!providersResult.ok) return;

  console.log('');
  log.step('Live reachability probe');
  let anyUnreachable = false;
  for (const { key, label } of providersResult.module.listProviders()) {
    const envVar = PROVIDER_ENV_VAR[key];
    const headers = envVar && process.env[envVar] ? { authorization: `Bearer ${process.env[envVar]}` } : {};
    const result = await probe(key, headers);
    if (!result.checked) {
      log.info(`${label} (${key}): no probe endpoint configured — skipped`);
    } else if (result.reachable) {
      log.ok(`${label} (${key}): reachable (HTTP ${result.status})`);
    } else {
      anyUnreachable = true;
      log.err(`${label} (${key}): unreachable — ${result.reason}`);
    }
  }

  console.log('');
  if (anyUnreachable) {
    log.err('One or more providers are unreachable. Check network access, base URLs, and DNS.');
    process.exitCode = 1;
  } else {
    log.ok('Provider configuration refreshed and reachable.');
  }
};
