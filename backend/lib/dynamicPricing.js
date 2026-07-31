'use strict';

const CREDIT_PRICE_USD = numberEnv('CREDIT_PRICE_USD', 0.01);

// Operational profit floor based on the configured reserves.
// This is not an absolute guarantee against unknown future expenses.
const TARGET_NET_MARGIN = numberEnv('TARGET_NET_MARGIN', 0.50);
const PAYMENT_FEE_RATE = numberEnv('PAYMENT_FEE_RATE', 0.06);
const TAX_RESERVE_RATE = numberEnv('TAX_RESERVE_RATE', 0.10);
const RISK_RESERVE_RATE = numberEnv('RISK_RESERVE_RATE', 0.05);
const INFRA_RESERVE_USD = numberEnv('INFRA_RESERVE_USD', 0.002);

function numberEnv(name, fallback) {
  const raw = process.env[name];

  if (raw === undefined || raw === '') {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw pricingError(`invalid_${name.toLowerCase()}`);
  }

  return value;
}

function requiredPositiveEnv(name) {
  const raw = process.env[name];
  const value = Number(raw);

  if (!raw || !Number.isFinite(value) || value <= 0) {
    throw pricingError(`missing_or_invalid_${name.toLowerCase()}`);
  }

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
    TARGET_NET_MARGIN +
    PAYMENT_FEE_RATE +
    TAX_RESERVE_RATE +
    RISK_RESERVE_RATE;

  const availableCostShare = 1 - percentageCosts;

  if (availableCostShare <= 0) {
    throw pricingError('invalid_margin_configuration');
  }

  return availableCostShare;
}

function imageProviderCosts() {
  const providers = [];

  // Every active provider must have a configured estimated cost.
  // The most expensive active provider is used because fallback routing
  // may send the request to any of them.
  if (process.env.FAL_KEY) {
    providers.push({
      provider: 'fal',
      costUsd: requiredPositiveEnv('FAL_IMAGE_COST_USD'),
    });
  }

  if (process.env.REPLICATE_API_TOKEN) {
    providers.push({
      provider: 'replicate',
      costUsd: requiredPositiveEnv('REPLICATE_IMAGE_COST_USD'),
    });
  }

  if (providers.length === 0) {
    throw pricingError('no_configured_image_provider');
  }

  return providers;
}

function providerQuote(feature) {
  if (feature === 'image') {
    const providers = imageProviderCosts();

    return providers.reduce((mostExpensive, current) =>
      current.costUsd > mostExpensive.costUsd ? current : mostExpensive
    );
  }

  if (feature === 'video') {
    if (!process.env.REPLICATE_API_TOKEN) {
      throw pricingError('no_configured_video_provider');
    }

    return {
      provider: 'replicate',
      costUsd: requiredPositiveEnv('REPLICATE_VIDEO_COST_USD'),
    };
  }

  throw pricingError(`unsupported_dynamic_feature_${feature}`);
}

function quoteGeneration(feature) {
  const availableCostShare = validateEconomics();
  const provider = providerQuote(feature);

  const fixedEstimatedCostUsd =
    provider.costUsd + INFRA_RESERVE_USD;

  const minimumRevenueUsd =
    fixedEstimatedCostUsd / availableCostShare;

  const credits = Math.max(
    1,
    Math.ceil(minimumRevenueUsd / CREDIT_PRICE_USD)
  );

  const revenueUsd = credits * CREDIT_PRICE_USD;

  const variableReservesUsd =
    revenueUsd *
    (PAYMENT_FEE_RATE + TAX_RESERVE_RATE + RISK_RESERVE_RATE);

  const estimatedNetProfitUsd =
    revenueUsd -
    provider.costUsd -
    INFRA_RESERVE_USD -
    variableReservesUsd;

  const estimatedNetMargin =
    revenueUsd > 0
      ? estimatedNetProfitUsd / revenueUsd
      : 0;

  if (estimatedNetMargin + Number.EPSILON < TARGET_NET_MARGIN) {
    throw pricingError('margin_floor_not_met');
  }

  return {
    feature,
    credits,
    revenueUsd: Number(revenueUsd.toFixed(6)),
    provider: provider.provider,
    providerCostUsd: provider.costUsd,
    estimatedNetProfitUsd: Number(estimatedNetProfitUsd.toFixed(6)),
    estimatedNetMargin: Number(estimatedNetMargin.toFixed(6)),
  };
}

module.exports = {
  quoteGeneration,
};