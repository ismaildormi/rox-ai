// ROX AI — src/core/config.js
//
// One place that knows how config is loaded. Everything else (feature
// flags, plan costs, model rates) reads through here instead of doing
// its own require('../../config/whatever.json') — so if config ever
// moves to a remote store (LaunchDarkly-style service, a Supabase
// table, etc.) at higher scale, only this file changes.
//
// Precedence, low to high: JSON file  ->  env var override.
// This keeps the JSON files as the readable, reviewable source of
// truth, while still letting ops flip a single number in production
// (e.g. FREE_DAILY_CHAT_LIMIT) without a code deploy.

const path = require('path');

const featureFlags = require(path.join(__dirname, '../../config/feature-flags.json'));
const plans = require(path.join(__dirname, '../../config/plans.json'));
const models = require(path.join(__dirname, '../../config/models.json'));
const advisor = require(path.join(__dirname, '../../config/advisor.json'));
const optimizerDefaults = require(path.join(__dirname, '../../config/optimizer.json'));
const diskMonitorDefaults = require(path.join(__dirname, '../../config/diskMonitor.json'));

function tier(name) {
  return plans.tiers[name] || null;
}

function featureCost(key) {
  return plans.featureCosts[key] || { credits: 0 };
}

// Small helper: env var wins if set, otherwise the config-file value.
// Used for the handful of numbers ops needs to tune live (rate limits,
// daily caps) without touching plans.json.
function withEnvOverride(envVarName, fallback) {
  const raw = process.env[envVarName];
  if (raw === undefined || raw === '') return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

module.exports = {
  featureFlags,
  plans,
  models,
  advisor,
  optimizerDefaults,
  diskMonitorDefaults,
  tier,
  featureCost,
  withEnvOverride,
};
