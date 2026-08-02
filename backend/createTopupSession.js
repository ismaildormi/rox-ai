const express = require('express');
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

const PRICE_PER_CREDIT_USD = Number(
  process.env.TOPUP_PRICE_PER_CREDIT_USD || 0.01
);

const MIN_TOPUP_USD = Number(process.env.MIN_TOPUP_USD || 10);
const MIN_TOPUP_CREDITS = Math.ceil(
  MIN_TOPUP_USD / PRICE_PER_CREDIT_USD
);

// High safety ceiling per purchase. It can be raised later by env variable.
const MAX_TOPUP_CREDITS = Number(
  process.env.MAX_TOPUP_CREDITS || 10000
);

function calculateTopupAmountCents(credits) {
  const pricePerCreditUsd =
    credits >= 5000 ? 0.008 : PRICE_PER_CREDIT_USD;

  return Math.round(credits * pricePerCreditUsd * 100);
}

router.post('/', async (req, res) => {
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
    success_url: `${process.env.APP_URL}/?topup=true`,
    cancel_url: `${process.env.APP_URL}/`,
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
});

module.exports = router;
