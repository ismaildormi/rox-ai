// ROX AI — cli/lib/aiBackend.js
//
// Shared loader for the `rox ai *` and `rox update models|providers`
// commands. Several backend/src/modules/ai files have zero external
// dependencies (providers/index.js, src/core/config.js) and always load
// fine here. Others (aiRouter.js -> lib/modelHealth.js -> lib/queue.js /
// lib/supabaseAdmin.js -> bullmq / ioredis / @supabase/supabase-js) need
// `npm install` to have run in backend/ and DB/Redis env vars to be set.
// Every loader here returns { ok, module, error } instead of throwing,
// so each CLI command decides for itself how to degrade (same pattern
// cli/commands/health.js already uses for the diskMonitor module).

const { tryLoad } = require('./backendLoader');

const loadProviders = () => tryLoad('src/modules/ai/providers');
const loadConfig = () => tryLoad('src/core/config');
const loadAiRouter = () => tryLoad('aiRouter');
const loadModelHealth = () => tryLoad('lib/modelHealth');
const loadFeatureFlags = () => tryLoad('src/core/featureFlags');

// Env var each built-in provider adapter reads today — mirrors
// src/modules/ai/providers/index.js exactly, so this map breaks loudly
// (via a `rox ai providers` mismatch) if that file's env vars ever
// change without this one being updated. `local` has no required key
// by default (most self-hosted runtimes don't need one); its "config"
// is the base URL instead.
const PROVIDER_ENV_VAR = {
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  groq: 'GROQ_API_KEY',
};

const PROVIDER_BASE_URL_VAR = {
  local: 'LOCAL_MODEL_BASE_URL',
};

const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434/v1';

module.exports = {
  tryLoad,
  loadProviders,
  loadConfig,
  loadAiRouter,
  loadModelHealth,
  loadFeatureFlags,
  PROVIDER_ENV_VAR,
  PROVIDER_BASE_URL_VAR,
  DEFAULT_LOCAL_BASE_URL,
};
