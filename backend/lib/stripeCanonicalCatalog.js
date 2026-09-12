'use strict';

const plans = require('../config/plans.json');
const stripeCatalog =
  require('../config/stripe-catalog.v1.json');

function nonEmpty(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0
  );
}

function canonicalStripeCatalogActive(env = process.env) {
  return (
    String(
      env[
        stripeCatalog.canonicalModeEnvKey
      ] || ''
    )
      .trim()
      .toLowerCase() === 'true'
  );
}

function subscriptionCatalog() {
  return Object.freeze(
    stripeCatalog.subscriptions.planIds.map(
      planId => {
        const plan =
          plans.tiers?.[planId];

        if (
          !plan ||
          plan.billing?.subscriptionEligible !== true ||
          !nonEmpty(
            plan.billing?.stripePriceEnvKey
          )
        ) {
          throw new Error(
            `invalid_subscription_catalog_${planId}`
          );
        }

        return Object.freeze({
          planId,
          monthlyPriceUsd:
            plan.monthlyPriceUsd,
          interval:
            plan.billing.interval ||
            stripeCatalog.subscriptions.interval,
          priceEnvKey:
            plan.billing.stripePriceEnvKey
        });
      }
    )
  );
}

function topupTierForCredits(credits) {
  if (
    !Number.isSafeInteger(credits) ||
    credits <
      stripeCatalog.topups.minCredits ||
    credits >
      stripeCatalog.topups.maxCredits
  ) {
    return null;
  }

  return (
    stripeCatalog.topups.tiers.find(
      tier =>
        credits >= tier.minCredits &&
        credits <= tier.maxCredits
    ) || null
  );
}

function roundMicrousdToCents(amountMicrousd) {
  const value = BigInt(amountMicrousd);
  const microUsdPerCent = 10000n;

  return Number(
    (
      value +
      microUsdPerCent / 2n
    ) /
      microUsdPerCent
  );
}

function quoteTopupCredits(
  credits,
  env = process.env,
  {
    requireConfiguredPrice = false
  } = {}
) {
  const tier =
    topupTierForCredits(credits);

  if (!tier) {
    const error =
      new Error('invalid_topup_credits');
    error.code =
      'invalid_topup_credits';
    error.minimumCredits =
      stripeCatalog.topups.minCredits;
    error.maximumCredits =
      stripeCatalog.topups.maxCredits;
    throw error;
  }

  const amountMicrousd =
    BigInt(credits) *
    BigInt(tier.unitPriceMicrousd);
  const amountCents =
    roundMicrousdToCents(
      amountMicrousd
    );
  const configuredId =
    nonEmpty(env[tier.priceEnvKey])
      ? env[tier.priceEnvKey].trim()
      : null;

  if (
    requireConfiguredPrice &&
    !configuredId
  ) {
    const error =
      new Error(
        'stripe_topup_price_not_configured'
      );
    error.code =
      'stripe_topup_price_not_configured';
    error.priceEnvKey =
      tier.priceEnvKey;
    throw error;
  }

  return Object.freeze({
    credits,
    tierId: tier.id,
    unitPriceMicrousd:
      tier.unitPriceMicrousd,
    amountMicrousd:
      amountMicrousd.toString(),
    amountCents,
    priceUsd:
      amountCents / 100,
    priceEnvKey:
      tier.priceEnvKey,
    stripePriceId:
      configuredId
  });
}

function requiredPriceBindings() {
  return Object.freeze([
    ...subscriptionCatalog().map(
      entry => entry.priceEnvKey
    ),
    ...stripeCatalog.topups.tiers.map(
      tier => tier.priceEnvKey
    )
  ]);
}

function catalogBindingState(
  env = process.env
) {
  const subscriptions =
    subscriptionCatalog().map(
      entry =>
        Object.freeze({
          planId: entry.planId,
          monthlyPriceUsd:
            entry.monthlyPriceUsd,
          interval: entry.interval,
          priceEnvKey:
            entry.priceEnvKey,
          configured:
            nonEmpty(
              env[entry.priceEnvKey]
            )
        })
    );

  const topups =
    stripeCatalog.topups.tiers.map(
      tier =>
        Object.freeze({
          tierId: tier.id,
          minCredits:
            tier.minCredits,
          maxCredits:
            tier.maxCredits,
          unitPriceMicrousd:
            tier.unitPriceMicrousd,
          priceEnvKey:
            tier.priceEnvKey,
          configured:
            nonEmpty(
              env[tier.priceEnvKey]
            )
        })
    );

  return Object.freeze({
    subscriptions:
      Object.freeze(subscriptions),
    topups:
      Object.freeze(topups),
    allPriceBindingsConfigured:
      [
        ...subscriptions,
        ...topups
      ].every(
        item =>
          item.configured === true
      )
  });
}

function publicStripeCatalog(
  env = process.env
) {
  const state =
    catalogBindingState(env);

  return Object.freeze({
    version:
      stripeCatalog.version,
    canonicalModeActive:
      canonicalStripeCatalogActive(env),
    externalGate:
      stripeCatalog.externalGate,
    secretsEmbedded: false,
    subscriptions:
      state.subscriptions,
    topups:
      state.topups,
    allPriceBindingsConfigured:
      state.allPriceBindingsConfigured,
    legacyTopupCompatibility:
      stripeCatalog.topups
        .legacyCompatibility
        .enabledWhenCanonicalModeOff ===
      true
  });
}

module.exports = {
  stripeCatalog,
  canonicalStripeCatalogActive,
  subscriptionCatalog,
  topupTierForCredits,
  quoteTopupCredits,
  requiredPriceBindings,
  catalogBindingState,
  publicStripeCatalog
};
