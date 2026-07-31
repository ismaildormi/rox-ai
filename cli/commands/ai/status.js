// ROX AI — cli/commands/ai/status.js
//
// One-screen composite: provider credentials, routed model pricing
// coverage, and the planned-but-not-yet-enabled AI feature flags
// (config/feature-flags.json). Deliberately does NOT re-run the
// per-model circuit check (`rox ai health` does that) — this is meant
// to be fast enough to run casually, that one hits Redis+Supabase per
// model.

const { log, loadEnv } = require('../../lib/util');
const { loadProviders, loadConfig, loadAiRouter, PROVIDER_ENV_VAR } = require('../../lib/aiBackend');

module.exports = async function status() {
  log.step('ROX AI — AI subsystem status');
  loadEnv();

  const providersResult = loadProviders();
  const configResult = loadConfig();
  const routerResult = loadAiRouter();

  if (providersResult.ok) {
    const list = providersResult.module.listProviders();
    const configuredCount = list.filter(({ key }) => {
      const envVar = PROVIDER_ENV_VAR[key];
      return !envVar || Boolean(process.env[envVar] && process.env[envVar].trim());
    }).length;
    log.ok(`Providers: ${list.length} registered, ${configuredCount} with credentials configured (\`rox ai providers\` for detail)`);
  } else {
    log.err(`Providers: could not load (${providersResult.error.message})`);
  }

  if (configResult.ok && routerResult.ok) {
    const { rates } = configResult.module.models;
    const routedModels = new Set(Object.values(routerResult.module.ROUTES).flat().map((r) => r.model));
    const priced = [...routedModels].filter((m) => m in rates).length;
    if (priced === routedModels.size) {
      log.ok(`Models: ${routedModels.size} routed, all priced (\`rox ai models\` for detail)`);
    } else {
      log.err(`Models: ${routedModels.size} routed, only ${priced} priced (\`rox ai models\` for detail)`);
    }
  } else {
    log.warn(`Models: could not cross-check (${(configResult.error || routerResult.error || {}).message || 'unknown error'})`);
  }

  if (routerResult.ok) {
    const features = Object.keys(routerResult.module.ROUTES);
    log.ok(`Routing: ${features.length} features configured (${features.join(', ')}) (\`rox ai routing\` for detail)`);
  } else {
    log.err(`Routing: could not load aiRouter.js (${routerResult.error.message})`);
  }

  console.log('');
  log.step('Planned AI features (config/feature-flags.json)');
  if (configResult.ok) {
    const flags = configResult.module.featureFlags;
    const aiFlagKeys = ['custom_ai_models', 'voice_ai', 'ai_agents', 'ai_personas', 'custom_tools', 'mcp_servers'];
    for (const key of aiFlagKeys) {
      const flag = flags[key];
      if (!flag) continue;
      const line = `${key}: ${flag.enabled ? 'ENABLED' : 'off'} (${flag.status}${flag.tier ? `, ${flag.tier}` : ''})`;
      if (flag.enabled) log.ok(line);
      else log.info(line);
    }
  } else {
    log.warn('Could not read feature flags.');
  }

  console.log('');
  log.info('Run `rox ai health` to check live circuit-breaker status per model (needs Redis + Supabase).');
};
