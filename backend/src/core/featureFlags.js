// ROX AI — src/core/featureFlags.js
//
// Every unimplemented feature in the product ("Prepare for future
// support of...") gets a key in config/feature-flags.json NOW, set to
// false. When the feature is actually built, flipping it to true (or
// enabling it for one user/org first) is the launch step — no route
// wiring, no schema migration, no redeploy of unrelated code.
//
// Three layers, checked in order (first match wins):
//   1. Per-user/org override      -> table `feature_flag_overrides`
//   2. Env var override           -> FEATURE_<KEY>=true/false
//   3. config/feature-flags.json  -> default for everyone
//
// Layer 1 is what lets you dogfood a feature with your own account, or
// give one paying org early access, before a public rollout — without
// a second code path. It's a soft dependency: if Supabase/the table
// isn't reachable, this silently falls back to layer 2/3 rather than
// throwing, because a flag check must never be able to take the whole
// API down.

const { featureFlags } = require('./config');

let supabaseAdmin = null;
try {
  // Lazy/optional require: featureFlags.js has no hard dependency on
  // Supabase being configured (useful in tests / early local dev).
  ({ supabaseAdmin } = require('../../lib/supabaseAdmin'));
} catch (_) {
  supabaseAdmin = null;
}

function envOverride(key) {
  const raw = process.env[`FEATURE_${key.toUpperCase()}`];
  if (raw === undefined) return undefined;
  return raw === 'true';
}

/**
 * @param {string} key - matches a key in config/feature-flags.json
 * @param {{userId?: string, orgId?: string}} context
 * @returns {Promise<boolean>}
 */
async function isEnabled(key, context = {}) {
  const definition = featureFlags[key];
  if (!definition) return false; // unknown flag = off, never throw

  if (supabaseAdmin && (context.userId || context.orgId)) {
    try {
      let query = supabaseAdmin.from('feature_flag_overrides').select('enabled').eq('flag_key', key);
      query = context.userId ? query.eq('user_id', context.userId) : query.eq('org_id', context.orgId);
      const { data } = await query.maybeSingle();
      if (data && typeof data.enabled === 'boolean') return data.enabled;
    } catch (_) {
      // fall through to env/file layers — see header note
    }
  }

  const env = envOverride(key);
  if (env !== undefined) return env;

  return Boolean(definition.enabled);
}

/** Sync variant for hot paths (e.g. deciding whether to even mount a route) where no per-user context is needed. */
function isEnabledGlobally(key) {
  const definition = featureFlags[key];
  if (!definition) return false;
  const env = envOverride(key);
  if (env !== undefined) return env;
  return Boolean(definition.enabled);
}

function describe(key) {
  return featureFlags[key] || null;
}

function all() {
  return featureFlags;
}

module.exports = { isEnabled, isEnabledGlobally, describe, all };
