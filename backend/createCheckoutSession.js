// ROX AI — Creates the Stripe Checkout session that the "Upgrade to Pro"
// button in the frontend calls. metadata.userId is what lets the webhook
// (stripeWebhook.js) know which account to upgrade after payment — it
// now comes from the verified session (req.userId, set by requireAuth
// in server.js), not from the request body, so a request can't name a
// different account to upgrade than the one that's actually paying.

const express = require('express');
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

router.post('/', async (req, res) => {
  const userId = req.userId;
  const userEmail = req.userEmail;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: userEmail,
    line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
    success_url: `${process.env.APP_URL}/dashboard?upgraded=true`,
    cancel_url: `${process.env.APP_URL}/dashboard`,
    metadata: { userId, type: 'subscription' }
  });

  res.json({ url: session.url });
});

module.exports = router;
