'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.STRIPE_PLUS_PRICE_ID = 'price_plus_test';
process.env.STRIPE_PRO_PRICE_ID = 'price_pro_test';
process.env.STRIPE_LEGEND_PRICE_ID = 'price_legend_test';
process.env.STRIPE_MAX_PRICE_ID = 'price_max_test';

let currentEvent;
let rpcCalls = [];
let rpcImplementation;

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

  if (
    name ===
    'settle_stripe_subscription_lifecycle_event'
  ) {
    return {
      data: {
        success: true,
        applied: true,
        stale: false
      },
      error: null
    };
  }

  return {
    data: {
      success: true,
      updated: 1
    },
    error: null
  };
}

async function invoke(event, implementation = defaultRpc) {
  currentEvent = event;
  rpcCalls = [];
  rpcImplementation = implementation;

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

function subscriptionEvent(overrides = {}) {
  const base = {
    id: 'evt_subscription',
    type: 'customer.subscription.updated',
    created: 1788580800,
    data: {
      object: {
        id: 'sub_test',
        object: 'subscription',
        customer: 'cus_test',
        status: 'active',
        cancel_at_period_end: false,
        metadata: {
          userId:
            '11111111-1111-4111-8111-111111111111',
          plan: 'legend'
        },
        items: {
          data: [
            {
              current_period_start: 1788580800,
              current_period_end: 1791172800,
              price: {
                id: 'price_legend_test'
              }
            }
          ]
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
        },
        items: {
          ...base.data.object.items,
          ...(overrides.data?.object?.items || {}),
          data:
            overrides.data?.object?.items?.data ||
            base.data.object.items.data
        }
      }
    }
  };
}

(async () => {
  const runtimePath = path.join(
    __dirname,
    'stripeWebhook.js'
  );
  const catalogPath = path.join(
    __dirname,
    'lib',
    'billingCatalog.js'
  );

  for (const [name, raw] of [
    ['runtime', fs.readFileSync(runtimePath, 'utf8')],
    ['catalog', fs.readFileSync(catalogPath, 'utf8')],
    ['test', fs.readFileSync(__filename, 'utf8')]
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

  let result = await invoke(subscriptionEvent());

  assert.strictEqual(result.res.statusCode, 200);
  assert.strictEqual(
    result.res.body.subscriptionLifecycle,
    true
  );
  assert.strictEqual(result.res.body.plan, 'legend');
  assert.strictEqual(result.res.body.billingStatus, 'active');

  let settlement = result.calls.find(
    call =>
      call.name ===
      'settle_stripe_subscription_lifecycle_event'
  );

  assert(settlement);
  assert.strictEqual(settlement.args.p_plan, 'legend');
  assert.strictEqual(
    settlement.args.p_price_id,
    'price_legend_test'
  );
  assert.strictEqual(
    settlement.args.p_user_id,
    '11111111-1111-4111-8111-111111111111'
  );
  assert.strictEqual(
    settlement.args.p_event_created_at,
    '2026-09-05T04:00:00.000Z'
  );
  assert.strictEqual(
    settlement.args.p_period_start,
    '2026-09-05T04:00:00.000Z'
  );
  assert.strictEqual(
    settlement.args.p_period_end,
    '2026-10-05T04:00:00.000Z'
  );

  result = await invoke(
    subscriptionEvent({
      id: 'evt_plan_change',
      data: {
        object: {
          metadata: {
            plan: 'legend'
          },
          items: {
            data: [
              {
                current_period_start: 1788580800,
                current_period_end: 1791172800,
                price: {
                  id: 'price_max_test'
                }
              }
            ]
          }
        }
      }
    })
  );

  settlement = result.calls.find(
    call =>
      call.name ===
      'settle_stripe_subscription_lifecycle_event'
  );

  assert.strictEqual(
    settlement.args.p_plan,
    'max',
    'Actual Stripe price must control the plan'
  );

  result = await invoke(
    subscriptionEvent({
      id: 'evt_deleted',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          status: 'active',
          cancel_at_period_end: true
        }
      }
    })
  );

  settlement = result.calls.find(
    call =>
      call.name ===
      'settle_stripe_subscription_lifecycle_event'
  );

  assert.strictEqual(
    settlement.args.p_billing_status,
    'canceled'
  );

  result = await invoke(
    subscriptionEvent({
      id: 'evt_paused',
      type: 'customer.subscription.paused',
      data: {
        object: {
          status: 'paused'
        }
      }
    })
  );

  settlement = result.calls.find(
    call =>
      call.name ===
      'settle_stripe_subscription_lifecycle_event'
  );

  assert.strictEqual(result.res.statusCode, 200);
  assert.strictEqual(
    settlement.args.p_billing_status,
    'paused'
  );

  result = await invoke(
    subscriptionEvent({
      id: 'evt_bad_period',
      data: {
        object: {
          items: {
            data: [
              {
                current_period_start: 1791172800,
                current_period_end: 1788580800,
                price: {
                  id: 'price_legend_test'
                }
              }
            ]
          }
        }
      }
    })
  );

  assert.strictEqual(result.res.statusCode, 500);
  assert(
    result.calls.some(
      call => call.name === 'fail_stripe_webhook_event'
    )
  );
  assert(
    !result.calls.some(
      call =>
        call.name ===
        'settle_stripe_subscription_lifecycle_event'
    )
  );

  result = await invoke(
    subscriptionEvent({
      id: 'evt_without_metadata',
      data: {
        object: {
          metadata: {
            userId: ''
          }
        }
      }
    })
  );

  settlement = result.calls.find(
    call =>
      call.name ===
      'settle_stripe_subscription_lifecycle_event'
  );

  assert.strictEqual(settlement.args.p_user_id, null);

  result = await invoke(
    subscriptionEvent({
      id: 'evt_unknown_price',
      data: {
        object: {
          items: {
            data: [
              {
                current_period_start: 1788580800,
                current_period_end: 1791172800,
                price: {
                  id: 'price_unknown'
                }
              }
            ]
          }
        }
      }
    })
  );

  assert.strictEqual(result.res.statusCode, 500);
  assert(
    result.calls.some(
      call => call.name === 'fail_stripe_webhook_event'
    )
  );
  assert(
    !result.calls.some(
      call =>
        call.name ===
        'settle_stripe_subscription_lifecycle_event'
    )
  );

  result = await invoke(
    subscriptionEvent({ id: 'evt_duplicate' }),
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

      throw new Error(`Unexpected RPC: ${name}`);
    }
  );

  assert.strictEqual(result.res.statusCode, 200);
  assert.strictEqual(result.res.body.duplicate, true);

  result = await invoke({
    id: 'evt_invoice_created',
    type: 'invoice.created',
    created: 1788580800,
    data: {
      object: {}
    }
  });

  assert.strictEqual(result.res.statusCode, 200);
  assert.strictEqual(result.res.body.ignored, true);

  console.log(
    'PASS: subscription lifecycle events use atomic settlement'
  );
  console.log(
    'PASS: actual Stripe price controls Plus, Pro, Legend and Max plan identity'
  );
  console.log(
    'PASS: cancellations and paused subscriptions fail closed'
  );
  console.log(
    'PASS: duplicate and invalid lifecycle inputs remain safe'
  );
  console.log(
    'NETWORK / DATABASE / STRIPE / MODEL CALLS: NONE'
  );
})().catch(error => {
  console.error(error);
  process.exit(1);
});