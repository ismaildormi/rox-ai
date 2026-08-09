'use strict';

const Stripe = require('stripe');

let stripeClient = null;
let stripeSecretSnapshot = null;

function missingEnvironmentVariables(keys, env = process.env) {
  return keys.filter(
    key => typeof env[key] !== 'string' || env[key].trim().length === 0
  );
}

function getStripeClient(env = process.env) {
  const secret = env.STRIPE_SECRET_KEY;

  if (!secret) {
    return null;
  }

  if (!stripeClient || stripeSecretSnapshot !== secret) {
    stripeClient = new Stripe(secret);
    stripeSecretSnapshot = secret;
  }

  return stripeClient;
}


function normalizeAppUrl(value = process.env.APP_URL) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function sendBillingUnavailable(res, missing = []) {
  if (missing.length > 0) {
    console.error(
      '[billing] configuration incomplete:',
      missing.join(', ')
    );
  }

  return res.status(503).json({
    status: 'error',
    code: 'billing_not_configured',
    message: 'Billing is temporarily unavailable.',
  });
}

module.exports = {
  getStripeClient,
  missingEnvironmentVariables,
  sendBillingUnavailable,
  normalizeAppUrl,
};
