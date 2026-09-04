'use strict';

const express = require('express');
const {
  getStripeClient,
  missingEnvironmentVariables,
  sendBillingUnavailable,
  normalizeAppUrl,
} = require('./lib/stripeClient');
const {
  getSubscriptionOffer
} = require('./lib/billingCatalog');

const router = express.Router();

function billingV1IsActive(env = process.env) {
  return String(env.ZUVYR_BILLING_V1_ACTIVE || '')
    .trim()
    .toLowerCase() === 'true';
}

router.post('/', async (req, res) => {
  if (!billingV1IsActive()) {
    return res.status(503).json({
      status: 'error',
      code: 'billing_not_active',
      message: 'The new billing system is not active yet.'
    });
  }

  const requestedPlan =
    typeof req.body?.plan === 'string'
      ? req.body.plan.trim().toLowerCase()
      : '';
  const offer = getSubscriptionOffer(requestedPlan);

  if (!offer) {
    return res.status(400).json({
      status: 'error',
      code: 'invalid_subscription_plan',
      message: 'Choose Plus, Pro, Legend or Max.'
    });
  }

  const missing = missingEnvironmentVariables([
    'STRIPE_SECRET_KEY',
    offer.priceEnvKey,
    'APP_URL',
  ]);
  const stripe = getStripeClient();

  if (missing.length > 0 || !stripe || !offer.stripePriceId) {
    return sendBillingUnavailable(res, missing);
  }

  try {
    const userId = req.userId;
    const userEmail = req.userEmail;
    const appUrl = normalizeAppUrl();
    const subscriptionMetadata = {
      userId,
      type: 'subscription',
      plan: offer.id
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      client_reference_id: userId,
      customer_email: userEmail,
      line_items: [{ price: offer.stripePriceId, quantity: 1 }],
      success_url: `${appUrl}/?upgraded=true`,
      cancel_url: `${appUrl}/`,
      metadata: subscriptionMetadata,
      subscription_data: {
        metadata: subscriptionMetadata
      }
    });

    return res.json({
      url: session.url,
      plan: offer.id,
      monthlyPriceUsd: offer.monthlyPriceUsd
    });
  } catch (error) {
    console.error('[billing/subscription] checkout failed:', error.message);
    return res.status(502).json({
      status: 'error',
      code: 'billing_provider_error',
      message: 'The payment provider could not create a checkout session.'
    });
  }
});

module.exports = router;
