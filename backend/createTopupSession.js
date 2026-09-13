'use strict';

const express = require('express');
const {
  getStripeClient,
  missingEnvironmentVariables,
  sendBillingUnavailable,
  normalizeAppUrl
} = require('./lib/stripeClient');
const {
  stripeCatalog,
  canonicalStripeCatalogActive,
  quoteTopupCredits
} = require('./lib/stripeCanonicalCatalog');

const router = express.Router();

const LEGACY_PRICE_PER_CREDIT_USD = Number(
  process.env.TOPUP_PRICE_PER_CREDIT_USD ||
    0.01
);

const LEGACY_MIN_TOPUP_USD = Number(
  process.env.MIN_TOPUP_USD || 10
);

const LEGACY_MIN_TOPUP_CREDITS =
  Math.ceil(
    LEGACY_MIN_TOPUP_USD /
      LEGACY_PRICE_PER_CREDIT_USD
  );

const LEGACY_MAX_TOPUP_CREDITS =
  Number(
    process.env.MAX_TOPUP_CREDITS ||
      10000
  );

function legacyAmountCents(credits) {
  const pricePerCreditUsd =
    credits >= 5000
      ? 0.008
      : LEGACY_PRICE_PER_CREDIT_USD;

  return Math.round(
    credits *
      pricePerCreditUsd *
      100
  );
}

function invalidCredits(
  res,
  {
    minimumCredits,
    maximumCredits,
    minimumUsd = null
  }
) {
  return res.status(400).json({
    status: 'error',
    code: 'invalid_topup_amount',
    message:
      `Credits must be an integer between ` +
      `${minimumCredits} and ${maximumCredits}.`,
    minimumCredits,
    maximumCredits,
    minimumUsd
  });
}

router.post('/', async (req, res) => {
  const userId = req.userId;
  const userEmail = req.userEmail;
  const credits =
    Number(req.body?.credits);
  const canonical =
    canonicalStripeCatalogActive(
      process.env
    );

  let amountCents;
  let lineItem;
  let metadata;

  if (canonical) {
    let quote;

    try {
      quote =
        quoteTopupCredits(
          credits,
          process.env,
          {
            requireConfiguredPrice:
              true
          }
        );
    } catch (error) {
      if (
        error.code ===
        'invalid_topup_credits'
      ) {
        return invalidCredits(
          res,
          {
            minimumCredits:
              error.minimumCredits,
            maximumCredits:
              error.maximumCredits,
            minimumUsd: 10
          }
        );
      }

      if (
        error.code ===
        'stripe_topup_price_not_configured'
      ) {
        return sendBillingUnavailable(
          res,
          [error.priceEnvKey]
        );
      }

      throw error;
    }

    const missing =
      missingEnvironmentVariables([
        'STRIPE_SECRET_KEY',
        'APP_URL',
        quote.priceEnvKey
      ]);

    const stripe =
      getStripeClient();

    if (
      missing.length > 0 ||
      !stripe
    ) {
      return sendBillingUnavailable(
        res,
        missing
      );
    }

    amountCents =
      quote.amountCents;

    lineItem = {
      price:
        quote.stripePriceId,
      quantity:
        quote.stripeCheckoutQuantity
    };

    metadata = {
      userId,
      type: 'topup',
      credits:
        String(credits),
      priceUsd:
        String(
          amountCents / 100
        ),
      stripeCatalogVersion:
        stripeCatalog.version,
      topupTier:
        quote.tierId,
      unitPriceMicrousd:
        String(
          quote.unitPriceMicrousd
        ),
      stripeBillingUnitCents:
        String(
          quote.stripeBillingUnitCents
        ),
      stripeCheckoutQuantity:
        String(
          quote.stripeCheckoutQuantity
        )
    };

    return createSession({
      req,
      res,
      stripe,
      userId,
      userEmail,
      credits,
      amountCents,
      lineItem,
      metadata,
      canonical: true
    });
  }

  const missing =
    missingEnvironmentVariables([
      'STRIPE_SECRET_KEY',
      'APP_URL'
    ]);

  const stripe =
    getStripeClient();

  if (
    missing.length > 0 ||
    !stripe
  ) {
    return sendBillingUnavailable(
      res,
      missing
    );
  }

  if (
    !Number.isInteger(credits) ||
    credits <
      LEGACY_MIN_TOPUP_CREDITS ||
    credits >
      LEGACY_MAX_TOPUP_CREDITS
  ) {
    return invalidCredits(
      res,
      {
        minimumCredits:
          LEGACY_MIN_TOPUP_CREDITS,
        maximumCredits:
          LEGACY_MAX_TOPUP_CREDITS,
        minimumUsd:
          LEGACY_MIN_TOPUP_USD
      }
    );
  }

  amountCents =
    legacyAmountCents(credits);

  lineItem = {
    price_data: {
      currency: 'usd',
      product_data: {
        name:
          `ZUVYR - ${credits} credits`
      },
      unit_amount:
        amountCents
    },
    quantity: 1
  };

  metadata = {
    userId,
    type: 'topup',
    credits:
      String(credits),
    priceUsd:
      String(
        amountCents / 100
      )
  };

  return createSession({
    req,
    res,
    stripe,
    userId,
    userEmail,
    credits,
    amountCents,
    lineItem,
    metadata,
    canonical: false
  });
});

async function createSession({
  res,
  stripe,
  userId,
  userEmail,
  credits,
  amountCents,
  lineItem,
  metadata,
  canonical
}) {
  const appUrl =
    normalizeAppUrl();

  try {
    const session =
      await stripe
        .checkout
        .sessions
        .create({
          mode: 'payment',
          payment_method_types: [
            'card'
          ],
          client_reference_id:
            userId || undefined,
          customer_email:
            userEmail,
          line_items: [
            lineItem
          ],
          success_url: `${appUrl}/?topup=true`,
          cancel_url:
            `${appUrl}/`,
          metadata
        });

    return res.json({
      url: session.url,
      credits,
      priceUsd:
        amountCents / 100,
      pricePerCreditUsd:
        amountCents /
        100 /
        credits,
      stripeCatalogVersion:
        canonical
          ? stripeCatalog.version
          : null,
      canonicalCatalog:
        canonical
    });
  } catch (error) {
    console.error(
      '[billing/topup] checkout failed:',
      error.message
    );

    return res.status(502).json({
      status: 'error',
      code: 'billing_provider_error',
      message:
        'The payment provider could not create a checkout session.'
    });
  }
}

module.exports = router;
