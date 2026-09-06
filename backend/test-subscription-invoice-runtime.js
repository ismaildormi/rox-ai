'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.STRIPE_PLUS_PRICE_ID = 'price_plus_test';
process.env.STRIPE_PRO_PRICE_ID = 'price_pro_test';
process.env.STRIPE_LEGEND_PRICE_ID = 'price_legend_test';
process.env.STRIPE_MAX_PRICE_ID = 'price_max_test';

let currentEvent;
let currentRetrieve;
let retrieveCalls = [];
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
  },
  subscriptions: {
    retrieve: async subscriptionId => {
      retrieveCalls.push(subscriptionId);
      return currentRetrieve(subscriptionId);
    }
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

function defaultRpc(name, args) {
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
    'settle_stripe_subscription_invoice_event'
  ) {
    return {
      data: {
        success: true,
        applied: true,
        stale: false,
        revenue_recorded:
          args.p_invoice_outcome === 'paid'
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

function subscription(overrides = {}) {
  const base = {
    id: 'sub_invoice_test',
    object: 'subscription',
    customer: 'cus_invoice_test',
    status: 'active',
    cancel_at_period_end: false,
    metadata: {
      userId: '11111111-1111-4111-8111-111111111111'
    },
    items: {
      data: [
        {
          current_period_start: 1788580800,
          current_period_end: 1791172800,
          price: {
            id: 'price_plus_test'
          }
        }
      ]
    }
  };

  return {
    ...base,
    ...overrides,
    metadata: {
      ...base.metadata,
      ...(overrides.metadata || {})
    },
    items: {
      ...base.items,
      ...(overrides.items || {}),
      data: overrides.items?.data || base.items.data
    }
  };
}

function invoiceEvent(overrides = {}) {
  const base = {
    id: 'evt_invoice_cycle',
    type: 'invoice.paid',
    created: 1788667200,
    livemode: false,
    data: {
      object: {
        id: 'in_cycle_test',
        object: 'invoice',
        billing_reason: 'subscription_cycle',
        customer: 'cus_invoice_test',
        currency: 'usd',
        amount_paid: 1000,
        amount_due: 1000,
        parent: {
          subscription_details: {
            subscription: 'sub_invoice_test'
          }
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
        ...(overrides.data?.object || {})
      }
    }
  };
}

async function invoke(event, options = {}) {
  currentEvent = event;
  rpcCalls = [];
  retrieveCalls = [];
  rpcImplementation = options.rpc || defaultRpc;
  currentRetrieve = options.retrieve || (() => subscription());

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
    calls: [...rpcCalls],
    retrieves: [...retrieveCalls]
  };
}

(async () => {
  const runtimeRaw = fs.readFileSync(
    path.join(__dirname, 'stripeWebhook.js'),
    'utf8'
  );
  const testRaw = fs.readFileSync(__filename, 'utf8');

  for (const [name, raw] of [
    ['runtime', runtimeRaw],
    ['test', testRaw]
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

  assert(runtimeRaw.includes("'invoice.paid'"));
  assert(runtimeRaw.includes("'invoice.payment_failed'"));
  assert(runtimeRaw.includes(
    'parent?.subscription_details?.subscription'
  ));
  assert(runtimeRaw.includes(
    'settle_stripe_subscription_invoice_event'
  ));

  let result = await invoke(invoiceEvent());

  assert.strictEqual(result.res.statusCode, 200);
  assert.strictEqual(
    result.res.body.subscriptionInvoice,
    true
  );
  assert.strictEqual(result.res.body.invoiceOutcome, 'paid');
  assert.strictEqual(result.res.body.plan, 'plus');
  assert.strictEqual(result.res.body.revenueRecorded, true);
  assert.deepStrictEqual(
    result.retrieves,
    ['sub_invoice_test']
  );

  let settlement = result.calls.find(
    call =>
      call.name ===
      'settle_stripe_subscription_invoice_event'
  );

  assert(settlement);
  assert.strictEqual(
    settlement.args.p_event_created_at,
    new Date(1788667200 * 1000).toISOString()
  );
  assert.strictEqual(
    settlement.args.p_invoice_id,
    'in_cycle_test'
  );
  assert.strictEqual(
    settlement.args.p_invoice_outcome,
    'paid'
  );
  assert.strictEqual(
    settlement.args.p_billing_reason,
    'subscription_cycle'
  );
  assert.strictEqual(
    settlement.args.p_user_id,
    '11111111-1111-4111-8111-111111111111'
  );
  assert.strictEqual(
    settlement.args.p_subscription_id,
    'sub_invoice_test'
  );
  assert.strictEqual(
    settlement.args.p_customer_id,
    'cus_invoice_test'
  );
  assert.strictEqual(
    settlement.args.p_price_id,
    'price_plus_test'
  );
  assert.strictEqual(settlement.args.p_plan, 'plus');
  assert.strictEqual(
    settlement.args.p_subscription_status,
    'active'
  );
  assert.strictEqual(settlement.args.p_amount_usd, 10);
  assert.strictEqual(settlement.args.p_currency, 'usd');

  result = await invoke(
    invoiceEvent({
      id: 'evt_invoice_plan_change',
      data: {
        object: {
          id: 'in_plan_change_test',
          billing_reason: 'subscription_update',
          amount_paid: 5000,
          amount_due: 5000
        }
      }
    }),
    {
      retrieve: () => subscription({
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
      })
    }
  );

  settlement = result.calls.find(
    call =>
      call.name ===
      'settle_stripe_subscription_invoice_event'
  );

  assert.strictEqual(result.res.statusCode, 200);
  assert.strictEqual(result.res.body.plan, 'legend');
  assert.strictEqual(
    settlement.args.p_billing_reason,
    'subscription_update'
  );
  assert.strictEqual(settlement.args.p_plan, 'legend');
  assert.strictEqual(settlement.args.p_amount_usd, 50);

  const legacyFailure = invoiceEvent({
    id: 'evt_invoice_failure',
    type: 'invoice.payment_failed',
    data: {
      object: {
        id: 'in_failure_test',
        amount_due: 2000
      }
    }
  });

  delete legacyFailure.data.object.parent;
  legacyFailure.data.object.subscription =
    'sub_invoice_test';

  result = await invoke(legacyFailure, {
    retrieve: () => subscription({
      status: 'past_due',
      items: {
        data: [
          {
            current_period_start: 1788580800,
            current_period_end: 1791172800,
            price: {
              id: 'price_pro_test'
            }
          }
        ]
      }
    })
  });

  assert.strictEqual(result.res.statusCode, 200);
  assert.strictEqual(
    result.res.body.invoiceOutcome,
    'payment_failed'
  );
  assert.strictEqual(result.res.body.plan, 'pro');
  assert.strictEqual(
    result.res.body.billingStatus,
    'past_due'
  );
  assert.strictEqual(
    result.res.body.revenueRecorded,
    false
  );

  settlement = result.calls.find(
    call =>
      call.name ===
      'settle_stripe_subscription_invoice_event'
  );

  assert.strictEqual(
    settlement.args.p_invoice_outcome,
    'payment_failed'
  );
  assert.strictEqual(settlement.args.p_amount_usd, 20);
  assert.strictEqual(
    settlement.args.p_subscription_status,
    'past_due'
  );

  result = await invoke(
    invoiceEvent({
      id: 'evt_initial_invoice',
      data: {
        object: {
          billing_reason: 'subscription_create'
        }
      }
    })
  );

  assert.strictEqual(result.res.statusCode, 200);
  assert.strictEqual(result.res.body.ignored, true);
  assert.strictEqual(
    result.res.body.reason,
    'initial_invoice_owned_by_checkout'
  );
  assert.strictEqual(result.retrieves.length, 0);
  assert(result.calls.some(
    call => call.name === 'complete_stripe_webhook_event'
  ));
  assert(!result.calls.some(
    call =>
      call.name ===
      'settle_stripe_subscription_invoice_event'
  ));

  result = await invoke(
    invoiceEvent({
      id: 'evt_manual_invoice',
      data: {
        object: {
          billing_reason: 'manual'
        }
      }
    })
  );

  assert.strictEqual(result.res.statusCode, 200);
  assert.strictEqual(result.res.body.ignored, true);
  assert.strictEqual(result.retrieves.length, 0);
  assert(result.calls.some(
    call => call.name === 'complete_stripe_webhook_event'
  ));

  result = await invoke(invoiceEvent({
    id: 'evt_retrieve_failure'
  }), {
    retrieve: async () => {
      throw new Error('stripe_unavailable');
    }
  });

  assert.strictEqual(result.res.statusCode, 500);
  assert.strictEqual(
    result.res.body.code,
    'webhook_processing_failed'
  );
  assert(result.calls.some(
    call =>
      call.name === 'fail_stripe_webhook_event' &&
      call.args.p_error === 'subscription_retrieval_failed'
  ));
  assert(!result.calls.some(
    call =>
      call.name ===
      'settle_stripe_subscription_invoice_event'
  ));

  result = await invoke(invoiceEvent({
    id: 'evt_unknown_invoice_price'
  }), {
    retrieve: () => subscription({
      items: {
        data: [
          {
            current_period_start: 1788580800,
            current_period_end: 1791172800,
            price: {
              id: 'price_unknown_test'
            }
          }
        ]
      }
    })
  });

  assert.strictEqual(result.res.statusCode, 500);
  assert(result.calls.some(
    call =>
      call.name === 'fail_stripe_webhook_event' &&
      call.args.p_error === 'unknown_subscription_price'
  ));

  result = await invoke(invoiceEvent({
    id: 'evt_duplicate_invoice'
  }), {
    rpc: name => {
      if (name === 'claim_stripe_webhook_event') {
        return {
          data: {
            success: true,
            action: 'duplicate'
          },
          error: null
        };
      }

      throw new Error('Unexpected RPC after duplicate claim');
    }
  });

  assert.strictEqual(result.res.statusCode, 200);
  assert.strictEqual(result.res.body.duplicate, true);
  assert.strictEqual(result.retrieves.length, 0);

  result = await invoke(
    invoiceEvent({
      id: 'evt_active_failure',
      type: 'invoice.payment_failed'
    }),
    {
      rpc: (name, args) => {
        if (name === 'claim_stripe_webhook_event') {
          return defaultRpc(name, args);
        }

        if (
          name ===
          'settle_stripe_subscription_invoice_event'
        ) {
          return {
            data: {
              success: true,
              applied: false,
              stale: true,
              revenue_recorded: false
            },
            error: null
          };
        }

        return defaultRpc(name, args);
      }
    }
  );

  assert.strictEqual(result.res.statusCode, 200);
  assert.strictEqual(result.res.body.stale, true);
  assert.strictEqual(result.res.body.applied, false);
  assert.strictEqual(
    result.res.body.revenueRecorded,
    false
  );

  console.log(
    'PASS: paid renewals and plan changes use atomic settlement'
  );
  console.log(
    'PASS: Stripe invoice subscription references support current and legacy APIs'
  );
  console.log(
    'PASS: payment failures never record revenue and remain ordered'
  );
  console.log(
    'PASS: initial and unsupported invoices complete without duplicate revenue'
  );
  console.log(
    'PASS: retrieval and validation failures return 500 and remain retryable'
  );
  console.log(
    'PASS: duplicate invoice deliveries cannot settle twice'
  );
  console.log(
    'NETWORK / DATABASE / STRIPE / MODEL CALLS: NONE'
  );
})().catch(error => {
  console.error(error);
  process.exit(1);
});
