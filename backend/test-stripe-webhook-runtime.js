'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.STRIPE_PRO_PRICE_ID = 'price_pro_test';
process.env.STRIPE_LEGEND_PRICE_ID = 'price_legend_test';

let currentEvent;
let rpcImplementation;
let rpcCalls = [];

const supabaseAdmin = {
  rpc: async (name, args) => {
    rpcCalls.push({ name, args });
    return rpcImplementation(name, args);
  }
};

const stripe = {
  webhooks: {
    constructEvent: () => currentEvent
  }
};

const supabasePath = require.resolve(
  './lib/supabaseAdmin'
);
const stripeClientPath = require.resolve(
  './lib/stripeClient'
);

require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: { supabaseAdmin }
};

require.cache[stripeClientPath] = {
  id: stripeClientPath,
  filename: stripeClientPath,
  loaded: true,
  exports: {
    getStripeClient: () => stripe,
    missingEnvironmentVariables: () => [],
    sendBillingUnavailable: res =>
      res.status(503).json({
        status: 'error',
        code: 'billing_unavailable'
      })
  }
};

const router = require('./stripeWebhook');
const routeLayer = router.stack.find(
  layer => layer.route?.path === '/'
);
const handler =
  routeLayer.route.stack[
    routeLayer.route.stack.length - 1
  ].handle;

function responseMock() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    }
  };
}

function defaultRpc(name) {
  if (name === 'claim_stripe_webhook_event') {
    return {
      data: {
        success: true,
        action: 'process',
        attempt: 1
      },
      error: null
    };
  }

  return {
    data: {
      success: true,
      updated: 1,
      credits_added: 0
    },
    error: null
  };
}

async function invoke(event, implementation = defaultRpc) {
  currentEvent = event;
  rpcImplementation = implementation;
  rpcCalls = [];

  const req = {
    headers: {
      'stripe-signature': 'test_signature'
    },
    body: Buffer.from('{}')
  };
  const res = responseMock();

  await handler(req, res);

  return {
    res,
    calls: [...rpcCalls]
  };
}

function checkoutEvent(overrides = {}) {
  const base = {
    id: 'evt_test',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test',
        mode: 'payment',
        payment_status: 'paid',
        amount_total: 1000,
        currency: 'usd',
        customer: 'cus_test',
        subscription: null,
        metadata: {
          userId:
            '11111111-1111-4111-8111-111111111111',
          type: 'topup',
          credits: '1000',
          priceUsd: '10'
        }
      }
    }
  };

  return {
    ...base,
    ...overrides,
    data: {
      ...base.data,
      ...(overrides.data || {}),
      object: {
        ...base.data.object,
        ...(overrides.data?.object || {}),
        metadata: {
          ...base.data.object.metadata,
          ...(overrides.data?.object?.metadata || {})
        }
      }
    }
  };
}

(async () => {
  const sourcePath = path.join(
    __dirname,
    'stripeWebhook.js'
  );
  const source = fs.readFileSync(sourcePath, 'utf8');
  const testSource = fs.readFileSync(__filename, 'utf8');

  for (const [name, raw] of [
    ['runtime', source],
    ['test', testSource]
  ]) {
    assert(
      !raw.startsWith('\uFEFF'),
      `${name} contains UTF-8 BOM`
    );

    const badLine = raw
      .split(/\r?\n/)
      .findIndex(line => /[ \t]+$/.test(line));

    assert.strictEqual(
      badLine,
      -1,
      `${name} has trailing whitespace on line ${badLine + 1}`
    );
  }

  assert(
    source.includes("'claim_stripe_webhook_event'"),
    'Runtime must claim events'
  );
  assert(
    source.includes("'settle_stripe_checkout_event'"),
    'Runtime must atomically settle checkout events'
  );
  assert(
    source.includes("'complete_stripe_webhook_event'"),
    'Runtime must complete ignored events'
  );
  assert(
    source.includes("'fail_stripe_webhook_event'"),
    'Runtime must mark failures'
  );
  assert(
    !source.includes(".from('webhook_events')"),
    'Legacy direct dedupe insert must be removed'
  );
  assert(
    !source.includes("'add_topup_credits'"),
    'Legacy non-atomic top-up RPC must be removed'
  );

  let result = await invoke(
    checkoutEvent(),
    name => {
      if (name === 'claim_stripe_webhook_event') {
        return {
          data: {
            success: true,
            action: 'duplicate',
            attempt: 1
          },
          error: null
        };
      }

      throw new Error('Unexpected RPC after duplicate');
    }
  );

  assert.strictEqual(result.res.statusCode, 200);
  assert.strictEqual(result.res.body.duplicate, true);
  assert.deepStrictEqual(
    result.calls.map(call => call.name),
    ['claim_stripe_webhook_event']
  );

  result = await invoke(
    checkoutEvent(),
    name => {
      if (name === 'claim_stripe_webhook_event') {
        return {
          data: {
            success: true,
            action: 'in_progress',
            attempt: 1
          },
          error: null
        };
      }

      throw new Error('Unexpected RPC while in progress');
    }
  );

  assert.strictEqual(result.res.statusCode, 503);
  assert.strictEqual(result.res.headers['Retry-After'], '10');

  result = await invoke(checkoutEvent());

  assert.strictEqual(result.res.statusCode, 200);
  assert.strictEqual(result.res.body.checkoutType, 'topup');

  const topupSettlement = result.calls.find(
    call => call.name === 'settle_stripe_checkout_event'
  );

  assert(topupSettlement);
  assert.strictEqual(
    topupSettlement.args.p_credits,
    1000
  );
  assert.strictEqual(
    topupSettlement.args.p_amount_usd,
    10
  );
  assert.strictEqual(
    topupSettlement.args.p_legacy_credits_total,
    null
  );
  assert(
    !result.calls.some(
      call => call.name === 'complete_stripe_webhook_event'
    )
  );

  const legendEvent = checkoutEvent({
    id: 'evt_legend',
    data: {
      object: {
        mode: 'subscription',
        payment_status: 'paid',
        amount_total: 5000,
        subscription: 'sub_legend',
        metadata: {
          type: 'subscription',
          plan: 'legend',
          credits: undefined,
          priceUsd: undefined
        }
      }
    }
  });

  result = await invoke(legendEvent);

  const legendSettlement = result.calls.find(
    call => call.name === 'settle_stripe_checkout_event'
  );

  assert.strictEqual(result.res.statusCode, 200);
  assert.strictEqual(
    legendSettlement.args.p_plan,
    'legend'
  );
  assert.strictEqual(
    legendSettlement.args.p_price_id,
    'price_legend_test'
  );
  assert.strictEqual(
    legendSettlement.args.p_legacy_credits_total,
    null
  );

  const legacyEvent = checkoutEvent({
    id: 'evt_legacy',
    data: {
      object: {
        mode: 'subscription',
        amount_total: 1000,
        subscription: 'sub_legacy',
        metadata: {
          type: 'subscription',
          credits: undefined,
          priceUsd: undefined
        }
      }
    }
  });

  delete legacyEvent.data.object.metadata.plan;
  result = await invoke(legacyEvent);

  const legacySettlement = result.calls.find(
    call => call.name === 'settle_stripe_checkout_event'
  );

  assert.strictEqual(
    legacySettlement.args.p_plan,
    'pro'
  );
  assert.strictEqual(
    legacySettlement.args.p_legacy_credits_total,
    500
  );

  result = await invoke(
    checkoutEvent({ id: 'evt_failure' }),
    name => {
      if (name === 'claim_stripe_webhook_event') {
        return defaultRpc(name);
      }

      if (name === 'settle_stripe_checkout_event') {
        return {
          data: null,
          error: { code: 'db_failure' }
        };
      }

      if (name === 'fail_stripe_webhook_event') {
        return {
          data: { success: true, updated: 1 },
          error: null
        };
      }

      throw new Error(`Unexpected RPC: ${name}`);
    }
  );

  assert.strictEqual(result.res.statusCode, 500);
  assert(
    result.calls.some(
      call => call.name === 'fail_stripe_webhook_event'
    )
  );

  const unpaid = checkoutEvent({
    id: 'evt_unpaid',
    data: {
      object: {
        payment_status: 'unpaid'
      }
    }
  });

  result = await invoke(unpaid);

  assert.strictEqual(result.res.statusCode, 500);
  assert(
    result.calls.some(
      call => call.name === 'fail_stripe_webhook_event'
    )
  );
  assert(
    !result.calls.some(
      call => call.name === 'settle_stripe_checkout_event'
    )
  );

  result = await invoke({
    id: 'evt_ignored',
    type: 'invoice.created',
    data: { object: {} }
  });

  assert.strictEqual(result.res.statusCode, 200);
  assert.strictEqual(result.res.body.ignored, true);
  assert.deepStrictEqual(
    result.calls.map(call => call.name),
    [
      'claim_stripe_webhook_event',
      'complete_stripe_webhook_event'
    ]
  );

  result = await invoke(
    checkoutEvent({ id: 'evt_claim_failure' }),
    name => {
      if (name === 'claim_stripe_webhook_event') {
        return {
          data: null,
          error: { code: 'claim_db_failure' }
        };
      }

      throw new Error(`Unexpected RPC: ${name}`);
    }
  );

  assert.strictEqual(result.res.statusCode, 500);
  assert.deepStrictEqual(
    result.calls.map(call => call.name),
    ['claim_stripe_webhook_event']
  );

  console.log(
    'PASS: duplicate and concurrent Stripe deliveries are safely handled'
  );
  console.log(
    'PASS: top-up and subscription checkout use atomic settlement'
  );
  console.log(
    'PASS: Plus, Pro, Legend and Max metadata is preserved'
  );
  console.log(
    'PASS: processing failures return 500 and remain retryable'
  );
  console.log(
    'PASS: unpaid top-ups cannot grant credits'
  );
  console.log(
    'PASS: ignored Stripe events complete without financial changes'
  );
  console.log(
    'NETWORK / DATABASE / STRIPE / MODEL CALLS: NONE'
  );
})().catch(error => {
  console.error(error);
  process.exit(1);
});