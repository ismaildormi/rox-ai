// ROX AI — Creates the Stripe Checkout session used by Upgrade to Pro.

const express = require('express');
const {
  getStripeClient,
  missingEnvironmentVariables,
  sendBillingUnavailable,
  normalizeAppUrl,
} = require('./lib/stripeClient');

const router = express.Router();

router.post('/', async (req, res) => {
  const missing = missingEnvironmentVariables([
    'STRIPE_SECRET_KEY',
    'STRIPE_PRO_PRICE_ID',
    'APP_URL',
  ]);

  const stripe = getStripeClient();
  if (missing.length > 0 || !stripe) {
    return sendBillingUnavailable(res, missing);
  }

  try {
    const userId = req.userId;
    const userEmail = req.userEmail;
    const appUrl = normalizeAppUrl();

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: userEmail,
      line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
      success_url: `${appUrl}/?upgraded=true`,
      cancel_url: `${appUrl}/`,
      metadata: { userId, type: 'subscription' },
    });

    return res.json({ url: session.url });
  } catch (error) {
    console.error('[billing/subscription] checkout failed:', error.message);
    return res.status(502).json({
      status: 'error',
      code: 'billing_provider_error',
      message: 'The payment provider could not create a checkout session.',
    });
  }
});

module.exports = router;
