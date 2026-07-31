// ROX AI — Creates a one-time Stripe Checkout session for purchasing
// extra credits on top of the monthly Pro allowance (500 credits/month,
// ~50% guaranteed margin — see gatekeeper.js and 08_maintenance.sql).
//
// Price is $0.02/credit — double the ~$0.01/credit worst-case real cost
// used to size the base plan, so top-ups carry the same ~50% margin as
// the subscription itself. Amount is chosen by the user (min/max
// bounded below), not by us picking a number for them.
//
// Unlike the subscription session (mode: 'subscription', fixed Price
// ID), this is mode: 'payment' with inline price_data, since the
// amount is variable per purchase.

const express = require('express');
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

const PRICE_PER_CREDIT_USD = Number(process.env.TOPUP_PRICE_PER_CREDIT_USD || 0.02);
const MIN_TOPUP_CREDITS = 50;   // $1.00
const MAX_TOPUP_CREDITS = 2500; // $50.00 — cap a single purchase to limit blast radius of any pricing/abuse bug

router.post('/', async (req, res) => {
  const userId = req.userId;
  const userEmail = req.userEmail;
  const credits = Number(req.body?.credits);

  if (!Number.isInteger(credits) || credits < MIN_TOPUP_CREDITS || credits > MAX_TOPUP_CREDITS) {
    return res.status(400).json({
      status: 'error',
      message: `credits must be an integer between ${MIN_TOPUP_CREDITS} and ${MAX_TOPUP_CREDITS}.`,
    });
  }

  const amountCents = Math.round(credits * PRICE_PER_CREDIT_USD * 100);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: userEmail,
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: `ROX AI — ${credits} credits (top-up)` },
        unit_amount: amountCents,
      },
      quantity: 1,
    }],
    success_url: `${process.env.APP_URL}/dashboard?topup=true`,
    cancel_url: `${process.env.APP_URL}/dashboard`,
    metadata: { userId, type: 'topup', credits: String(credits) },
  });

  res.json({ url: session.url, credits, priceUsd: amountCents / 100 });
});

module.exports = router;
