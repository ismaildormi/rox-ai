// ROX AI — Stripe Webhook
// Stripe calls this endpoint automatically after a successful checkout.
// It flips the user's subscription_status to 'pro' in the database —
// no manual action needed on your side.

const express = require('express');
const Stripe = require('stripe');
const { supabaseAdmin } = require('./lib/supabaseAdmin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Stripe documents that the same event can be delivered more than once
  // (retries, manual resends). This handler is currently idempotent in
  // effect (it always sets the same fixed values), but recording the
  // event id makes that safe-by-construction instead of safe-by-luck,
  // and any future additive handler (grant N credits, send an email)
  // won't silently double-fire.
  const { error: dedupeError } = await supabaseAdmin
    .from('webhook_events')
    .insert([{ event_id: event.id, event_type: event.type }]);

  if (dedupeError) {
    // Unique violation on event_id = already processed this one. Ack it
    // (so Stripe stops retrying) without redoing the work. Any other
    // error just gets logged — we still ack, since retrying won't fix
    // a non-dedupe DB error and Stripe's retry backoff isn't the place
    // to surface it.
    if (dedupeError.code !== '23505') {
      console.error('[stripeWebhook] webhook_events insert failed:', dedupeError.message);
    }
    return res.json({ received: true, duplicate: dedupeError.code === '23505' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const type = session.metadata?.type;

    // Revenue capture for the Business Advisor (revenue_events,
    // 13_advisor_optimizer_schema.sql). Additive, fire-and-forget: never
    // throws, never blocks the subscription/credit logic below — same
    // non-blocking posture as src/modules/analytics/events.js's track().
    // amount_total is in the smallest currency unit (cents for usd).
    try {
      await supabaseAdmin.from('revenue_events').insert({
        user_id: userId || null,
        event_type: type === 'topup' ? 'topup' : 'subscription',
        amount_usd: Number(session.amount_total || 0) / 100,
        currency: session.currency || 'usd',
        stripe_event_id: event.id,
        metadata: { session_id: session.id, mode: session.mode },
      });
    } catch (revenueErr) {
      console.error('[stripeWebhook] revenue_events insert failed:', revenueErr.message);
    }

    if (userId && type === 'topup') {
      const credits = Number(session.metadata?.credits || 0);
      const { data, error } = await supabaseAdmin.rpc('add_topup_credits', {
        p_user_id: userId,
        p_credits: credits,
      });
      if (error || !data?.success) {
        console.error('[webhook] add_topup_credits failed:', error?.message || data?.error);
      }
    } else if (userId) {
      // Default / 'subscription': 500 credits/month is the paid-for
      // pool sized for a ~50% guaranteed margin on the $10 plan — no
      // longer 999999 (true-unlimited), which had no real cost ceiling
      // at all. credits_used resets to 0 on a fresh upgrade; the
      // monthly renewal reset lives in 08_maintenance.sql.
      await supabaseAdmin
        .from('profiles')
        .update({
          subscription_status: 'pro',
          credits_total: 500,
          credits_used: 0,
          last_reset_date: new Date().toISOString(),
        })
        .eq('id', userId);
    }
  }

  res.json({ received: true });
});

module.exports = router;
