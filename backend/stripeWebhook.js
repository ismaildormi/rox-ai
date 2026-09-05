'use strict';

const express = require('express');
const { supabaseAdmin } = require('./lib/supabaseAdmin');
const {
  getStripeClient,
  missingEnvironmentVariables,
  sendBillingUnavailable
} = require('./lib/stripeClient');
const {
  getSubscriptionOffer,
  getSubscriptionOfferByPriceId
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

const SUBSCRIPTION_LIFECYCLE_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed'
]);

const SUBSCRIPTION_STATUSES = new Set([
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'paused',
  'canceled',
  'incomplete',
  'incomplete_expired'
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stripeTimestamp(value) {
  const seconds = Number(value);

  if (!Number.isInteger(seconds) || seconds <= 0) {
    return null;
  }

  const date = new Date(seconds * 1000);

  return Number.isFinite(date.getTime())
    ? date.toISOString()
    : null;
}

function subscriptionLifecyclePayload(event) {
  const subscription = event.data?.object;

  if (
    !subscription ||
    subscription.object !== 'subscription'
  ) {
    throw processingError('invalid_subscription_object');
  }

  const subscriptionId = normalizeStripeId(subscription);
  const customerId = normalizeStripeId(subscription.customer);
  const eventCreatedAt = stripeTimestamp(event.created);

  if (!subscriptionId) {
    throw processingError('invalid_subscription_id');
  }

  if (!customerId) {
    throw processingError('invalid_subscription_customer');
  }

  if (!eventCreatedAt) {
    throw processingError('invalid_subscription_event_time');
  }

  const items = Array.isArray(subscription.items?.data)
    ? subscription.items.data
    : [];

  if (items.length !== 1) {
    throw processingError('invalid_subscription_items');
  }

  const item = items[0];
  const priceId =
    normalizeStripeId(item?.price) ||
    normalizeStripeId(item?.plan);
  const offer = getSubscriptionOfferByPriceId(priceId);

  if (!priceId || !offer) {
    throw processingError('unknown_subscription_price');
  }

  const periodStart = stripeTimestamp(
    item?.current_period_start ??
      subscription.current_period_start
  );
  const periodEnd = stripeTimestamp(
    item?.current_period_end ??
      subscription.current_period_end
  );

  let billingStatus =
    typeof subscription.status === 'string'
      ? subscription.status.trim().toLowerCase()
      : '';

  if (event.type === 'customer.subscription.deleted') {
    billingStatus = 'canceled';
  }

  if (!SUBSCRIPTION_STATUSES.has(billingStatus)) {
    throw processingError('invalid_subscription_status');
  }

  if (
    billingStatus === 'active' ||
    billingStatus === 'trialing' ||
    billingStatus === 'past_due'
  ) {
    if (
      !periodStart ||
      !periodEnd ||
      Date.parse(periodEnd) <= Date.parse(periodStart)
    ) {
      throw processingError('invalid_subscription_period');
    }
  }

  const rawUserId =
    typeof subscription.metadata?.userId === 'string'
      ? subscription.metadata.userId.trim()
      : '';

  if (rawUserId && !UUID_PATTERN.test(rawUserId)) {
    throw processingError('invalid_subscription_user_id');
  }

  return {
    eventCreatedAt,
    userId: rawUserId || null,
    subscriptionId,
    customerId,
    priceId,
    plan: offer.id,
    billingStatus,
    periodStart,
    periodEnd,
    cancelAtPeriodEnd:
      subscription.cancel_at_period_end === true
  };
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
      if (SUBSCRIPTION_LIFECYCLE_EVENTS.has(event.type)) {
        const lifecycle = subscriptionLifecyclePayload(event);

        const lifecycleResult = await supabaseAdmin.rpc(
          'settle_stripe_subscription_lifecycle_event',
          {
            p_event_id: event.id,
            p_event_created_at: lifecycle.eventCreatedAt,
            p_user_id: lifecycle.userId,
            p_subscription_id: lifecycle.subscriptionId,
            p_customer_id: lifecycle.customerId,
            p_price_id: lifecycle.priceId,
            p_plan: lifecycle.plan,
            p_billing_status: lifecycle.billingStatus,
            p_period_start: lifecycle.periodStart,
            p_period_end: lifecycle.periodEnd,
            p_cancel_at_period_end:
              lifecycle.cancelAtPeriodEnd
          }
        );

        const settlement = requireRpcSuccess(
          'subscription_lifecycle_settlement',
          lifecycleResult
        );

        return res.json({
          received: true,
          processed: true,
          subscriptionLifecycle: true,
          eventType: event.type,
          plan: lifecycle.plan,
          billingStatus: lifecycle.billingStatus,
          applied: settlement.applied !== false,
          stale: settlement.stale === true
        });
      }

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