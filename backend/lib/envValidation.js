'use strict';

function isNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidHttpUrl(value) {
  if (!isNonEmpty(value)) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function collectMissing(env, keys) {
  return keys.filter(key => !isNonEmpty(env[key]));
}

function validateBillingConfiguration(env, warnings) {
  const stripeKeys = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRO_PRICE_ID',
    'APP_URL',
  ];

  const configured = stripeKeys.filter(key => isNonEmpty(env[key]));

  if (configured.length > 0 && configured.length < stripeKeys.length) {
    const missing = collectMissing(env, stripeKeys);
    warnings.push(
      `Stripe is partially configured. Missing: ${missing.join(', ')}. Billing routes will return 503.`
    );
  }

  if (isNonEmpty(env.APP_URL) && !isValidHttpUrl(env.APP_URL)) {
    warnings.push('APP_URL must be an absolute http(s) URL.');
  }
}

function validateProviderConfiguration(env, warnings) {
  if (!isNonEmpty(env.FAL_KEY) && !isNonEmpty(env.REPLICATE_API_TOKEN)) {
    warnings.push(
      'No image provider is configured. Image generation jobs will fail until FAL_KEY or REPLICATE_API_TOKEN is set.'
    );
  }

  if (!isNonEmpty(env.REPLICATE_API_TOKEN)) {
    warnings.push(
      'REPLICATE_API_TOKEN is not set. Video generation is unavailable.'
    );
  }
}

function validateServerEnvironment(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];

  const coreKeys = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];

  if (production) {
    coreKeys.push('REDIS_URL', 'OPENROUTER_API_KEY');
  }

  const missingCore = collectMissing(env, coreKeys);
  if (missingCore.length > 0) {
    errors.push(`Missing required environment variables: ${missingCore.join(', ')}`);
  }

  if (isNonEmpty(env.SUPABASE_URL) && !isValidHttpUrl(env.SUPABASE_URL)) {
    errors.push('SUPABASE_URL must be an absolute http(s) URL.');
  }

  if (production && !isNonEmpty(env.ALLOWED_ORIGINS)) {
    warnings.push(
      'ALLOWED_ORIGINS is empty. Only the built-in localhost and rox-ai-sepia.vercel.app origins will be allowed.'
    );
  }

  if (production && !isNonEmpty(env.METRICS_TOKEN)) {
    warnings.push('METRICS_TOKEN is not set. /metrics remains publicly readable.');
  }

  if (production && !isNonEmpty(env.CRON_SECRET)) {
    warnings.push('CRON_SECRET is not set. Internal scheduled routes remain disabled.');
  }

  validateBillingConfiguration(env, warnings);
  validateProviderConfiguration(env, warnings);

  return { errors, warnings };
}

function validateWorkerEnvironment(env = process.env) {
  const errors = [];
  const warnings = [];

  const missingCore = collectMissing(env, [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'REDIS_URL',
  ]);

  if (missingCore.length > 0) {
    errors.push(`Missing required worker environment variables: ${missingCore.join(', ')}`);
  }

  if (!isNonEmpty(env.FAL_KEY) && !isNonEmpty(env.REPLICATE_API_TOKEN)) {
    warnings.push(
      'No image provider is configured. Image jobs will exhaust retries and be refunded.'
    );
  }

  if (!isNonEmpty(env.REPLICATE_API_TOKEN)) {
    warnings.push(
      'REPLICATE_API_TOKEN is not set. Video jobs will exhaust retries and be refunded.'
    );
  }

  return { errors, warnings };
}

function reportEnvironmentValidation(result, options = {}) {
  const logger = options.logger || console;
  const component = options.component || 'server';

  for (const warning of result.warnings) {
    logger.warn(`[env:${component}] ${warning}`);
  }

  if (result.errors.length > 0) {
    const error = new Error(
      `[env:${component}] ${result.errors.join(' ')}`
    );
    error.code = 'invalid_environment';
    error.validationErrors = result.errors;
    throw error;
  }

  return result;
}

module.exports = {
  isNonEmpty,
  isValidHttpUrl,
  validateServerEnvironment,
  validateWorkerEnvironment,
  reportEnvironmentValidation,
};
