'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  parseAllowedOrigins,
  createCorsMiddleware,
} = require('./lib/cors');
const {
  validateServerEnvironment,
  validateWorkerEnvironment,
} = require('./lib/envValidation');
const { createHeaderSecretGuard } = require('./lib/operatorAuth');

function mockResponse() {
  const headers = new Map();

  return {
    statusCode: null,
    headers,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), String(value));
    },
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
    sendStatus(status) {
      this.statusCode = status;
      return this;
    },
  };
}

function runCors(req) {
  const res = mockResponse();
  let nextCalled = false;
  const middleware = createCorsMiddleware({
    allowedOrigins: parseAllowedOrigins('https://custom.rox.ai'),
  });

  middleware(req, res, () => {
    nextCalled = true;
  });

  return { res, nextCalled };
}

{
  const { res, nextCalled } = runCors({
    method: 'GET',
    headers: { origin: 'https://custom.rox.ai' },
  });

  assert.strictEqual(nextCalled, true);
  assert.strictEqual(
    res.getHeader('access-control-allow-origin'),
    'https://custom.rox.ai'
  );
  assert.match(
    res.getHeader('access-control-allow-methods'),
    /PATCH/
  );
  assert.strictEqual(res.getHeader('vary'), 'Origin');
}

{
  const { res, nextCalled } = runCors({
    method: 'GET',
    headers: { origin: 'https://attacker.example' },
  });

  assert.strictEqual(nextCalled, true);
  assert.strictEqual(
    res.getHeader('access-control-allow-origin'),
    undefined
  );
}

{
  const { res, nextCalled } = runCors({
    method: 'OPTIONS',
    headers: { origin: 'https://rox-ai-sepia.vercel.app' },
  });

  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 204);
  assert.strictEqual(
    res.getHeader('access-control-allow-origin'),
    'https://rox-ai-sepia.vercel.app'
  );
}

{
  const result = validateServerEnvironment({
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    REDIS_URL: 'redis://redis:6379',
    OPENROUTER_API_KEY: 'openrouter-key',
    ALLOWED_ORIGINS: 'https://app.rox.ai',
    METRICS_TOKEN: 'metrics-token',
    CRON_SECRET: 'cron-secret',
    MAINTENANCE_STRATEGY: 'railway_internal_route',
  });

  assert.deepStrictEqual(result.errors, []);
}

{
  const result = validateServerEnvironment({
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    REDIS_URL: 'redis://redis:6379',
    OPENROUTER_API_KEY: 'openrouter-key',
    ALLOWED_ORIGINS: 'https://app.rox.ai',
    METRICS_TOKEN: 'metrics-token',
    CRON_SECRET: 'cron-secret',
  });

  assert(
    result.errors.includes(
      'CRON_SECRET may only be enabled with MAINTENANCE_STRATEGY=railway_internal_route.'
    )
  );
}

{
  const result = validateServerEnvironment({
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    REDIS_URL: 'redis://redis:6379',
    OPENROUTER_API_KEY: 'openrouter-key',
    ALLOWED_ORIGINS: 'https://app.rox.ai',
    METRICS_TOKEN: 'metrics-token',
    MAINTENANCE_STRATEGY: 'railway_internal_route',
  });

  assert(
    result.errors.includes(
      'MAINTENANCE_STRATEGY is enabled but CRON_SECRET is missing.'
    )
  );
}

{
  const result = validateServerEnvironment({ NODE_ENV: 'production' });
  assert(result.errors.length > 0);
  assert(result.errors.join(' ').includes('SUPABASE_URL'));
  assert(result.errors.join(' ').includes('OPENROUTER_API_KEY'));
}

{
  const result = validateWorkerEnvironment({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    REDIS_URL: 'redis://redis:6379',
  });

  assert.deepStrictEqual(result.errors, []);
  assert(result.warnings.some(message => message.includes('Video jobs')));
}


function runHeaderGuard({ envName, headerName, expected, provided }) {
  const previous = process.env[envName];
  if (expected === undefined) delete process.env[envName];
  else process.env[envName] = expected;

  const headers = new Map();
  const res = {
    statusCode: null,
    body: null,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), String(value));
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  let nextCalled = false;
  const guard = createHeaderSecretGuard({
    envName,
    headerName,
    disabledCode: 'test_not_configured',
  });
  guard(
    { headers: provided === undefined ? {} : { [headerName.toLowerCase()]: provided } },
    res,
    () => { nextCalled = true; }
  );

  if (previous === undefined) delete process.env[envName];
  else process.env[envName] = previous;

  return { res, headers, nextCalled };
}

{
  const result = runHeaderGuard({
    envName: 'PACK004_TEST_SECRET',
    headerName: 'x-test-secret',
    expected: undefined,
  });
  assert.strictEqual(result.res.statusCode, 503);
  assert.strictEqual(result.res.body.code, 'test_not_configured');
  assert.strictEqual(result.nextCalled, false);
  assert.strictEqual(result.headers.get('cache-control'), 'no-store');
}

{
  const expected = 'pack-004-test-secret-0123456789abcdef';
  const missing = runHeaderGuard({
    envName: 'PACK004_TEST_SECRET',
    headerName: 'x-test-secret',
    expected,
  });
  assert.strictEqual(missing.res.statusCode, 401);
  assert.strictEqual(missing.nextCalled, false);

  const wrong = runHeaderGuard({
    envName: 'PACK004_TEST_SECRET',
    headerName: 'x-test-secret',
    expected,
    provided: expected + '-wrong',
  });
  assert.strictEqual(wrong.res.statusCode, 401);
  assert.strictEqual(wrong.nextCalled, false);

  const correct = runHeaderGuard({
    envName: 'PACK004_TEST_SECRET',
    headerName: 'x-test-secret',
    expected,
    provided: expected,
  });
  assert.strictEqual(correct.res.statusCode, null);
  assert.strictEqual(correct.nextCalled, true);
  assert.strictEqual(correct.headers.get('cache-control'), 'no-store');
}

const backendDir = __dirname;
const read = name => fs.readFileSync(path.join(backendDir, name), 'utf8');
const server = read('server.js');
const checkout = read('createCheckoutSession.js');
const topup = read('createTopupSession.js');
const webhook = read('stripeWebhook.js');

assert.strictEqual(
  (server.match(/createCorsMiddleware\(\)/g) || []).length,
  1,
  'The server must apply exactly one CORS middleware.'
);
assert.strictEqual(
  (server.match(/Access-Control-Allow-Origin/g) || []).length,
  0,
  'No backend route may bypass the single CORS policy with a direct Access-Control-Allow-Origin header.'
);

assert(
  server.includes("app.get('/metrics', requireMetricsAccess"),
  '/metrics must use the fail-closed metrics guard.'
);
assert(
  !server.includes('req.query.token'),
  '/metrics must not accept secrets through the query string.'
);
const maintenanceOperatorRouteGuardOrder =
  /app\.post\(\s*['"]\/internal\/maintenance\/run['"]\s*,\s*requireMaintenanceStrategy\s*,\s*requireCronAccess\s*,/m;

assert(
  maintenanceOperatorRouteGuardOrder.test(server) &&
    server.includes("app.get('/internal/margin-summary', requireCronAccess") &&
    server.includes("app.post('/internal/advisor/run-daily', requireCronAccess") &&
    server.includes("app.post('/internal/disk/run-scan', requireCronAccess"),
  'All operator routes must use the shared fail-closed cron guard.'
);

for (const [name, source] of [
  ['subscription checkout', checkout],
  ['top-up checkout', topup],
  ['Stripe webhook', webhook],
]) {
  assert(
    source.includes('billing_not_configured') ||
      source.includes('sendBillingUnavailable'),
    `${name} must fail safely when Stripe is not configured.`
  );
  assert(
    !source.includes('new Stripe(process.env.STRIPE_SECRET_KEY)'),
    `${name} must not instantiate Stripe at module load time.`
  );
}


assert(
  !checkout.includes('/dashboard'),
  'Checkout redirects must target the single-page frontend root, not a missing /dashboard route.'
);
assert(
  checkout.includes("success_url: `${appUrl}/?upgraded=true`") &&
    topup.includes("success_url: `${appUrl}/?topup=true`"),
  'Billing redirects must use the normalized APP_URL root.'
);

console.log('ROX AI runtime-safety regression checks passed.');
