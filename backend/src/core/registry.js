// ROX AI — src/core/registry.js
//
// The one generic pattern behind every "extension point" in this
// project: a named bucket you can register things into, and look them
// up by name later, without the caller knowing how many things exist
// or importing them directly.
//
// Concretely this is what lets:
//   - a new AI provider (voice, image, a customer's own model) be added
//     by registering it under 'ai.providers', not by editing aiRouter.js
//   - a new custom tool / MCP server be added under 'ai.tools'
//   - a new notification channel (email, push, webhook, Slack) be added
//     under 'notifications.channels'
//   - a community/marketplace plugin be loaded under 'plugins'
// ...all with the SAME mechanism, so there's exactly one pattern to
// learn instead of one bespoke system per feature.
//
// Deliberately in-memory and process-local. At current scale that's
// the right tradeoff (zero infra cost, zero latency). If a future
// registry ever needs to be shared/dynamic across many server
// instances (e.g. marketplace plugins installed at runtime without a
// redeploy), swap this module's internals for a DB-backed lookup —
// callers use registry.get()/list() either way, so nothing above this
// file has to change.

const buckets = new Map();

function bucket(name) {
  if (!buckets.has(name)) buckets.set(name, new Map());
  return buckets.get(name);
}

/** @param {string} bucketName e.g. 'ai.providers' @param {string} key e.g. 'anthropic' */
function register(bucketName, key, value) {
  bucket(bucketName).set(key, value);
}

function get(bucketName, key) {
  return bucket(bucketName).get(key) || null;
}

function list(bucketName) {
  return Array.from(bucket(bucketName).entries()).map(([key, value]) => ({ key, value }));
}

function has(bucketName, key) {
  return bucket(bucketName).has(key);
}

module.exports = { register, get, list, has };
