'use strict';

const express = require('express');
const { supabaseAdmin } = require('./lib/supabaseAdmin');
const {
  getStripeClient,
  missingEnvironmentVariables,
  sendBillingUnavailable
} = require('./lib/stripeClient');
const {
  getSubscriptionOffer
} = require('./lib/billingCatalog');

const router = express.Router();

function processingError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeStripeId(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (
    value &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    value.id.trim()
  ) {
    return value.id.trim();
  }

  return null;
}

function requireRpcSuccess(name, result) {
  const error = result?.error;
  const data = result?.data;

  if (error || !data?.success) {
    const code =
      error?.code ||
      data?.error ||
      `${name}_failed`;

    throw processingError(String(code).slice(0, 120));
  }

  return data;
}

async function markEventFailed(eventId, reason) {
  try {
    const result = await supabaseAdmin.rpc(
      'fail_stripe_webhook_event',
      {
        p_event_id: eventId,
        p_error: String(reason || 'processing_failed').slice(0, 120)
      }
    );

    if (result?.error || !result?.data?.success) {
      console.error(
        '[stripeWebhook] failed to record failed event:',
        eventId
      );
    }
  } catch {
    console.error(
      '[stripeWebhook] failed to record failed event:',
      eventId
    );
  }
}

router.post(
  '/',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const missing = missingEnvironmentVariables([
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET'
    ]);
    const stripe = getStripeClient();

    if (missing.length > 0 || !stripe) {
      return sendBillingUnavailable(res, missing);
    }

    const signature = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_webhook_signature',
        message: 'Webhook signature verification failed.'
      });
    }

    let claim;

    try {
      const claimResult = await supabaseAdmin.rpc(
        'claim_stripe_webhook_event',
        {
          p_event_id: event.id,
          p_event_type: event.type
        }
      );

      claim = requireRpcSuccess(
        'webhook_claim',
        claimResult
      );
    } catch (error) {
      console.error(
        '[stripeWebhook] event claim failed:',
        event.id,
        error.code || 'webhook_claim_failed'
      );

      return res.status(500).json({
        received: false,
        code: 'webhook_claim_failed'
      });
    }

    if (claim.action === 'duplicate') {
      return res.json({
        received: true,
        duplicate: true
      });
    }

    if (claim.action === 'in_progress') {
      res.set('Retry-After', '10');

      return res.status(503).json({
        received: false,
        code: 'webhook_in_progress'
      });
    }

    if (claim.action !== 'process') {
      return res.status(500).json({
        received: false,
        code: 'invalid_webhook_claim'
      });
    }

    try {
      if (event.type !== 'checkout.session.completed') {
        const completionResult = await supabaseAdmin.rpc(
          'complete_stripe_webhook_event',
          {
            p_event_id: event.id
          }
        );

        requireRpcSuccess(
          'webhook_completion',
          completionResult
        );

        return res.json({
          received: true,
          ignored: true
        });
      }

      const session = event.data?.object;
      const metadata = session?.metadata || {};
      const userId =
        typeof metadata.userId === 'string'
          ? metadata.userId.trim()
          : '';
      const checkoutType =
        typeof metadata.type === 'string'
          ? metadata.type.trim().toLowerCase()
          : '';

      if (!session || !userId) {
        throw processingError('invalid_checkout_metadata');
      }

      if (
        checkoutType !== 'topup' &&
        checkoutType !== 'subscription'
      ) {
        throw processingError('invalid_checkout_type');
      }

      const amountCents = Number(session.amount_total);

      if (
        !Number.isInteger(amountCents) ||
        amountCents < 0
      ) {
        throw processingError('invalid_checkout_amount');
      }

      let credits = 0;
      let plan = null;
      let legacyCreditsTotal = null;
      let priceId = null;

      if (checkoutType === 'topup') {
        if (
          session.mode !== 'payment' ||
          session.payment_status !== 'paid'
        ) {
          throw processingError('topup_payment_not_paid');
        }

        credits = Number(metadata.credits);

        if (!Number.isInteger(credits) || credits <= 0) {
          throw processingError('invalid_topup_credits');
        }

        const expectedPriceUsd = Number(metadata.priceUsd);

        if (
          Number.isFinite(expectedPriceUsd) &&
          Math.round(expectedPriceUsd * 100) !== amountCents
        ) {
          throw processingError('topup_amount_mismatch');
        }
      } else {
        if (session.mode !== 'subscription') {
          throw processingError('invalid_subscription_mode');
        }

        const suppliedPlan =
          typeof metadata.plan === 'string'
            ? metadata.plan.trim().toLowerCase()
            : '';

        if (suppliedPlan) {
          const offer = getSubscriptionOffer(suppliedPlan);

          if (!offer) {
            throw processingError(
              'invalid_subscription_plan'
            );
          }

          plan = offer.id;
          priceId = offer.stripePriceId;
        } else {
          plan = 'pro';
          legacyCreditsTotal = 500;
          priceId =
            typeof process.env.STRIPE_PRO_PRICE_ID === 'string'
              ? process.env.STRIPE_PRO_PRICE_ID.trim() || null
              : null;
        }
      }

      const settlementResult = await supabaseAdmin.rpc(
        'settle_stripe_checkout_event',
        {
          p_event_id: event.id,
          p_user_id: userId,
          p_checkout_type: checkoutType,
          p_plan: plan,
          p_credits: credits,
          p_amount_usd: amountCents / 100,
          p_currency:
            typeof session.currency === 'string'
              ? session.currency
              : 'usd',
          p_customer_id:
            normalizeStripeId(session.customer),
          p_subscription_id:
            normalizeStripeId(session.subscription),
          p_price_id: priceId,
          p_metadata: {
            session_id: session.id || null,
            mode: session.mode || null,
            plan
          },
          p_legacy_credits_total: legacyCreditsTotal
        }
      );

      const settlement = requireRpcSuccess(
        'checkout_settlement',
        settlementResult
      );

      return res.json({
        received: true,
        processed: true,
        checkoutType,
        plan,
        creditsAdded:
          Number(settlement.credits_added || 0)
      });
    } catch (error) {
      const reason =
        typeof error?.code === 'string'
          ? error.code
          : 'webhook_processing_failed';

      console.error(
        '[stripeWebhook] event processing failed:',
        event.id,
        reason
      );

      await markEventFailed(event.id, reason);

      return res.status(500).json({
        received: false,
        code: 'webhook_processing_failed'
      });
    }
  }
);

module.exports = router;