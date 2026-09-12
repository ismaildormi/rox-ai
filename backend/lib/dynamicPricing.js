'use strict';

// Pack 015 compatibility shim.
// All pricing decisions use integer micro-USD + integer basis points.
// USD numbers below are display-only compatibility fields produced after the
// exact decision has already been made.
const {
  resolveLegacyGenerationCostEntry,
  estimateProviderCostMicroUsd
} = require('./costRegistry');
const {
  BPS_SCALE,
  integer,
  ceilDiv
} = require('./exactMoney');
const { quoteTechnicalCost } = require('./technicalCostModel');

function pricingError(reason) {
  const error = new Error(reason);
  error.code = 'pricing_unconfigured';
  return error;
}

function decimalUsdToMicroUsd(raw, name, fallback, { allowZero = false } = {}) {
  const text = String(raw === undefined || raw === '' ? fallback : raw).trim();
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(text)) {
    throw pricingError(`invalid_${name.toLowerCase()}`);
  }

  const [whole, fraction = ''] = text.split('.');
  const result =
    BigInt(whole) * 1000000n +
    BigInt((fraction + '000000').slice(0, 6));

  if (result < 0n || (!allowZero && result === 0n)) {
    throw pricingError(`invalid_${name.toLowerCase()}`);
  }
  return result;
}

function decimalRateToBps(raw, name, fallback) {
  const text = String(raw === undefined || raw === '' ? fallback : raw).trim();
  if (!/^(0|1)(\.[0-9]{1,4})?$/.test(text)) {
    throw pricingError(`invalid_${name.toLowerCase()}`);
  }

  const [whole, fraction = ''] = text.split('.');
  const bps =
    BigInt(whole) * BPS_SCALE +
    BigInt((fraction + '0000').slice(0, 4));

  if (bps < 0n || bps > BPS_SCALE) {
    throw pricingError(`invalid_${name.toLowerCase()}`);
  }
  return bps;
}

function economicsFromEnv(env = process.env) {
  const creditValue = decimalUsdToMicroUsd(
    env.CREDIT_PRICE_USD,
    'CREDIT_PRICE_USD',
    '0.01'
  );
  const targetNetMarginBps = decimalRateToBps(
    env.TARGET_NET_MARGIN,
    'TARGET_NET_MARGIN',
    '0.50'
  );
  const paymentFeeBps = decimalRateToBps(
    env.PAYMENT_FEE_RATE,
    'PAYMENT_FEE_RATE',
    '0.06'
  );
  const taxReserveBps = decimalRateToBps(
    env.TAX_RESERVE_RATE,
    'TAX_RESERVE_RATE',
    '0.10'
  );
  const riskReserveBps = decimalRateToBps(
    env.RISK_RESERVE_RATE,
    'RISK_RESERVE_RATE',
    '0.05'
  );
  const infrastructureReserve = decimalUsdToMicroUsd(
    env.INFRA_RESERVE_USD,
    'INFRA_RESERVE_USD',
    '0.002',
    { allowZero: true }
  );
  const combinedMargin =
    targetNetMarginBps + paymentFeeBps + taxReserveBps + riskReserveBps;

  if (combinedMargin >= BPS_SCALE) {
    throw pricingError('invalid_margin_configuration');
  }

  return Object.freeze({
    creditValueMicroUsd: creditValue.toString(),
    minimumChargeCredits: '1',
    targetGrossMarginBps: combinedMargin.toString(),
    providerCostReserveBps: '0',
    retryFailureReserveBps: '0',
    currencyChangeReserveBps: '0',
    infrastructureReserveMicroUsd: infrastructureReserve.toString(),
    targetNetMarginBps: targetNetMarginBps.toString(),
    paymentFeeBps: paymentFeeBps.toString(),
    taxReserveBps: taxReserveBps.toString(),
    riskReserveBps: riskReserveBps.toString()
  });
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
    return Object.freeze({
      provider,
      providerCostMicroUsd,
      pricingVersion: entry.registryVersion
    });
  });

  return providers.reduce((mostExpensive, current) =>
    BigInt(current.providerCostMicroUsd) > BigInt(mostExpensive.providerCostMicroUsd)
      ? current
      : mostExpensive
  );
}

function microUsdDisplayNumber(value) {
  const amount = integer(value, 'display_micro_usd');
  const whole = amount / 1000000n;
  const fraction = String(amount % 1000000n).padStart(6, '0');
  return Number(`${whole}.${fraction}`);
}

function marginDisplayNumber(bps) {
  return Number(integer(bps, 'display_margin_bps')) / 10000;
}

function quoteGeneration(feature, options = {}) {
  const env = options.env || process.env;
  const economics = economicsFromEnv(env);
  const provider = providerQuote(feature, { ...options, env });
  const technical = quoteTechnicalCost({
    providerCostMicroUsd: provider.providerCostMicroUsd,
    components: [],
    pricingVersion: provider.pricingVersion,
    basis: 'estimate',
    economics
  });

  const creditValue = BigInt(economics.creditValueMicroUsd);
  const targetNetMargin = BigInt(economics.targetNetMarginBps);
  const variableReserveBps =
    BigInt(economics.paymentFeeBps) +
    BigInt(economics.taxReserveBps) +
    BigInt(economics.riskReserveBps);
  const fixedTechnicalCost = BigInt(
    technical.trace.allInTechnicalCostMicroUsd
  );

  let credits = BigInt(technical.charge.chargedCredits);
  let revenue;
  let variableReserves;
  let estimatedNetProfit;
  let estimatedNetMarginBps;

  for (let attempts = 0; attempts < 4; attempts += 1) {
    revenue = credits * creditValue;
    variableReserves = ceilDiv(
      revenue * variableReserveBps,
      BPS_SCALE
    );
    estimatedNetProfit =
      revenue - fixedTechnicalCost - variableReserves;
    estimatedNetMarginBps = revenue === 0n
      ? 0n
      : (estimatedNetProfit * BPS_SCALE) / revenue;

    if (estimatedNetMarginBps >= targetNetMargin) break;
    credits += 1n;
  }

  if (estimatedNetMarginBps < targetNetMargin) {
    throw pricingError('margin_floor_not_met');
  }
  if (credits > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw pricingError('credit_quote_too_large');
  }

  // Exact fields are authoritative. Numeric USD fields are display/API
  // compatibility only and are never read back into pricing decisions.
  return Object.freeze({
    feature,
    credits: Number(credits),
    revenueUsd: microUsdDisplayNumber(revenue),
    provider: provider.provider,
    providerCostUsd: microUsdDisplayNumber(provider.providerCostMicroUsd),
    providerCostMicroUsd: provider.providerCostMicroUsd,
    pricingVersion: provider.pricingVersion,
    estimatedNetProfitUsd: microUsdDisplayNumber(estimatedNetProfit),
    estimatedNetMargin: marginDisplayNumber(estimatedNetMarginBps),
    revenueMicroUsd: revenue.toString(),
    infrastructureCostMicroUsd:
      technical.trace.infrastructureCostMicroUsd,
    technicalCostMicroUsd:
      technical.trace.allInTechnicalCostMicroUsd,
    variableReservesMicroUsd: variableReserves.toString(),
    estimatedNetProfitMicroUsd: estimatedNetProfit.toString(),
    estimatedNetMarginBps: estimatedNetMarginBps.toString(),
    targetNetMarginBps: economics.targetNetMarginBps,
    pricingDecisionMode: 'exact_integer_micro_usd',
    technicalCostTrace: technical.trace,
    settlementAudit: Object.freeze({
      ...technical.settlementAudit,
      revenueMicroUsd: revenue.toString(),
      estimatedNetProfitMicroUsd: estimatedNetProfit.toString(),
      estimatedNetMarginBps: estimatedNetMarginBps.toString(),
      variableReservesMicroUsd: variableReserves.toString()
    })
  });
}

module.exports = {
  quoteGeneration,
  economicsFromEnv
};
