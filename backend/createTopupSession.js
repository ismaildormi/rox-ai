const express = require('express');
const {
  getStripeClient,
  missingEnvironmentVariables,
  sendBillingUnavailable,
  normalizeAppUrl,
} = require('./lib/stripeClient');

const router = express.Router();

const PRICE_PER_CREDIT_USD = Number(
  process.env.TOPUP_PRICE_PER_CREDIT_USD || 0.01
);

const MIN_TOPUP_USD = Number(process.env.MIN_TOPUP_USD || 10);
const MIN_TOPUP_CREDITS = Math.ceil(
  MIN_TOPUP_USD / PRICE_PER_CREDIT_USD
);

const MAX_TOPUP_CREDITS = Number(
  process.env.MAX_TOPUP_CREDITS || 10000
);

function calculateTopupAmountCents(credits) {
  const pricePerCreditUsd =
    credits >= 5000 ? 0.008 : PRICE_PER_CREDIT_USD;

  return Math.round(credits * pricePerCreditUsd * 100);
}

router.post('/', async (req, res) => {
  const missing = missingEnvironmentVariables([
    'STRIPE_SECRET_KEY',
    'APP_URL',
  ]);

  const stripe = getStripeClient();
  if (missing.length > 0 || !stripe) {
    return sendBillingUnavailable(res, missing);
  }

  const userId = req.userId;
  const userEmail = req.userEmail;
  const credits = Number(req.body?.credits);

  if (
    !Number.isInteger(credits) ||
    credits < MIN_TOPUP_CREDITS ||
    credits > MAX_TOPUP_CREDITS
  ) {
    return res.status(400).json({
      status: 'error',
      message:
        `Credits must be an integer between ` +
        `${MIN_TOPUP_CREDITS} and ${MAX_TOPUP_CREDITS}.`,
      minimumUsd: MIN_TOPUP_USD,
    });
  }

  const amountCents = calculateTopupAmountCents(credits);
  const appUrl = normalizeAppUrl();

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: userEmail,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `ROX AI - ${credits} credits`,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      success_url: `${appUrl}/?topup=true`,
      cancel_url: `${appUrl}/`,
      metadata: {
        userId,
        type: 'topup',
        credits: String(credits),
        priceUsd: String(amountCents / 100),
      },
    });

    return res.json({
      url: session.url,
      credits,
      priceUsd: amountCents / 100,
      pricePerCreditUsd: amountCents / 100 / credits,
    });
  } catch (error) {
    console.error('[billing/topup] checkout failed:', error.message);
    return res.status(502).json({
      status: 'error',
      code: 'billing_provider_error',
      message: 'The payment provider could not create a checkout session.',
    });
  }
});

module.exports = router;
