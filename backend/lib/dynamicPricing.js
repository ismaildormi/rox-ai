'use strict';

// Pack 014 compatibility shim. Provider prices are resolved only through
// lib/costRegistry; these environment values remain customer-economics inputs.
const {
  resolveLegacyGenerationCostEntry,
  estimateProviderCostMicroUsd
} = require('./costRegistry');

const CREDIT_PRICE_USD = numberEnv('CREDIT_PRICE_USD', 0.01);
const TARGET_NET_MARGIN = numberEnv('TARGET_NET_MARGIN', 0.50);
const PAYMENT_FEE_RATE = numberEnv('PAYMENT_FEE_RATE', 0.06);
const TAX_RESERVE_RATE = numberEnv('TAX_RESERVE_RATE', 0.10);
const RISK_RESERVE_RATE = numberEnv('RISK_RESERVE_RATE', 0.05);
const INFRA_RESERVE_USD = numberEnv('INFRA_RESERVE_USD', 0.002);

function numberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw pricingError(`invalid_${name.toLowerCase()}`);
  return value;
}

function pricingError(reason) {
  const error = new Error(reason);
  error.code = 'pricing_unconfigured';
  return error;
}

function validateEconomics() {
  if (!Number.isFinite(CREDIT_PRICE_USD) || CREDIT_PRICE_USD <= 0) {
    throw pricingError('invalid_credit_price');
  }
  const percentageCosts =
    TARGET_NET_MARGIN + PAYMENT_FEE_RATE + TAX_RESERVE_RATE + RISK_RESERVE_RATE;
  const availableCostShare = 1 - percentageCosts;
  if (availableCostShare <= 0) throw pricingError('invalid_margin_configuration');
  return availableCostShare;
}

function configuredProviders(feature, env) {
  if (feature === 'image') {
    const providers = [];
    if (env.FAL_KEY) providers.push('fal');
    if (env.REPLICATE_API_TOKEN) providers.push('replicate');
    if (providers.length === 0) throw pricingError('no_configured_image_provider');
    return providers;
  }
  if (feature === 'video') {
    if (!env.REPLICATE_API_TOKEN) throw pricingError('no_configured_video_provider');
    return ['replicate'];
  }
  throw pricingError(`unsupported_dynamic_feature_${feature}`);
}

function providerQuote(feature, { env = process.env, now = Date.now() } = {}) {
  const providers = configuredProviders(feature, env).map(provider => {
    const entry = resolveLegacyGenerationCostEntry(provider, feature, { env, now });
    const providerCostMicroUsd = estimateProviderCostMicroUsd(entry);
    return {
      provider,
      providerCostMicroUsd,
      costUsd: Number(providerCostMicroUsd) / 1000000,
      pricingVersion: entry.registryVersion
    };
  });

  return providers.reduce((mostExpensive, current) =>
    BigInt(current.providerCostMicroUsd) > BigInt(mostExpensive.providerCostMicroUsd)
      ? current
      : mostExpensive
  );
}

function quoteGeneration(feature, options = {}) {
  const availableCostShare = validateEconomics();
  const provider = providerQuote(feature, options);
  const fixedEstimatedCostUsd = provider.costUsd + INFRA_RESERVE_USD;
  const minimumRevenueUsd = fixedEstimatedCostUsd / availableCostShare;
  const credits = Math.max(1, Math.ceil(minimumRevenueUsd / CREDIT_PRICE_USD));
  const revenueUsd = credits * CREDIT_PRICE_USD;
  const variableReservesUsd =
    revenueUsd * (PAYMENT_FEE_RATE + TAX_RESERVE_RATE + RISK_RESERVE_RATE);
  const estimatedNetProfitUsd =
    revenueUsd - provider.costUsd - INFRA_RESERVE_USD - variableReservesUsd;
  const estimatedNetMargin = revenueUsd > 0 ? estimatedNetProfitUsd / revenueUsd : 0;

  if (estimatedNetMargin + Number.EPSILON < TARGET_NET_MARGIN) {
    throw pricingError('margin_floor_not_met');
  }

  return {
    feature,
    credits,
    revenueUsd: Number(revenueUsd.toFixed(6)),
    provider: provider.provider,
    providerCostUsd: provider.costUsd,
    providerCostMicroUsd: provider.providerCostMicroUsd,
    pricingVersion: provider.pricingVersion,
    estimatedNetProfitUsd: Number(estimatedNetProfitUsd.toFixed(6)),
    estimatedNetMargin: Number(estimatedNetMargin.toFixed(6))
  };
}

module.exports = { quoteGeneration };
