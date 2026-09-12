'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const {
  mountZuvyrUsageSummary,
  windowSummary,
  publicUsageRecord
} = require('./lib/zuvyrUsageSummary');

const owner =
  '6f3a9c23-c4f2-4fef-8ed1-ae61f94bf758';
const time =
  Date.parse('2026-09-09T02:00:00Z');

const profile = {
  subscription_status: 'pro',
  topup_credits_balance: 9,
  usage_units_total: 100,
  usage_units_used: 90,
  usage_window_started_at:
    '2026-09-09T01:00:00Z',
  usage_window_ends_at:
    '2026-09-09T06:00:00Z',
  usage_week_units_total: 400,
  usage_week_units_used: 200,
  usage_week_started_at:
    '2026-09-08T00:00:00Z',
  usage_week_ends_at:
    '2026-09-15T00:00:00Z'
};

const historyRows = [
  {
    id: 11,
    capability: 'chat',
    usage_kind: 'chat_request',
    funding_source: 'subscription',
    reserved_credits: 2,
    actual_credits: 1,
    refunded_credits: 1,
    state: 'settled',
    accounting_state: 'used',
    created_at: '2026-09-09T01:34:00Z',
    settled_at: '2026-09-09T01:34:01Z',
    updated_at: '2026-09-09T01:34:01Z',
    provider: 'PRIVATE',
    model_tool: 'PRIVATE',
    provider_usage: {
      prompt: 'PRIVATE PROMPT'
    }
  },
  {
    id: 12,
    capability: 'code',
    usage_kind: 'ai_code_edit',
    funding_source: 'topup',
    reserved_credits: 2,
    actual_credits: null,
    refunded_credits: 0,
    state: 'reserved',
    accounting_state: 'reserved',
    created_at: '2026-09-09T01:35:00Z',
    settled_at: null,
    updated_at: '2026-09-09T01:35:00Z'
  }
];

async function request({
  profileError = false,
  historyError = false,
  authenticated = true,
  who = owner
} = {}) {
  let route;
  const reads = [];

  const auth = (req, res, next) =>
    authenticated
      ? (req.userId = who, next())
      : res.status(401).json({
          status: 'error'
        });

  const db = {
    from(table) {
      let key;
      let value;
      let fields = '';

      const query = {
        select(selected) {
          fields = selected;
          assert(
            !selected.includes('*')
          );
          return query;
        },
        eq(k, v) {
          key = k;
          value = v;
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        single() {
          return query;
        },
        then(resolve, reject) {
          reads.push({
            table,
            key,
            value,
            fields
          });

          assert.equal(value, who);
          assert.equal(
            key,
            table === 'profiles'
              ? 'id'
              : 'user_id'
          );

          const result =
            table === 'profiles'
              ? {
                  data: { ...profile },
                  error: profileError
                }
              : {
                  error: historyError,
                  data: historyRows
                };

          return Promise
            .resolve(result)
            .then(resolve, reject);
        }
      };

      return query;
    }
  };

  mountZuvyrUsageSummary(
    {
      get(url, ...handlers) {
        assert.equal(
          url,
          '/api/zuvyr-usage-summary'
        );
        route = handlers;
      }
    },
    {
      requireAuth: auth,
      db,
      now: () => time
    }
  );

  const res = {
    statusCode: 200,
    headers: {},
    set(key, value) {
      this.headers[key] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };

  const req = {
    query: {
      user_id: 'someone-else'
    },
    body: {
      userId: 'someone-else'
    }
  };

  await route[0](
    req,
    res,
    () => route[1](req, res)
  );

  return {
    res,
    reads
  };
}

(async () => {
  let { res, reads } = await request();

  assert.equal(
    res.body.version,
    'pack-018.unified-usage-billing-ux.v1'
  );
  assert.equal(res.body.plan, 'pro');
  assert.equal(res.body.topupCredits, 9);
  assert.equal(res.body.fiveHour.remaining, 10);
  assert.equal(res.body.weekly.remaining, 200);
  assert.deepEqual(
    res.body.warnings,
    {
      fiveHourRemainingPercentThreshold: 10,
      weeklyRemainingPercentThreshold: null
    }
  );
  assert.equal(
    res.body.recentRequestsAvailable,
    true
  );
  assert.equal(
    res.body.recentRequests.length,
    2
  );
  assert.equal(
    res.body.recentRequests[0].capability,
    'chat'
  );
  assert.equal(
    res.body.recentRequests[0].creditsCharged,
    1
  );
  assert.equal(
    res.body.recentRequests[1].creditsCharged,
    null
  );
  assert.equal(
    res.body.recentChat.length,
    1
  );
  assert.equal(reads.length, 2);
  assert.equal(
    reads[1].table,
    'zuvyr_usage_records'
  );
  assert(
    reads[1].fields.includes('capability')
  );
  assert(
    !reads[1].fields.includes('provider')
  );
  assert.equal(
    res.headers['Cache-Control'],
    'private, no-store'
  );
  assert.equal(
    res.headers.Vary,
    'Authorization'
  );

  const serialized =
    JSON.stringify(res.body);

  assert(
    !serialized.includes('PRIVATE')
  );
  assert(
    !serialized.includes(owner)
  );

  console.log(
    'PASS: unified Usage/Billing source returns plan, 5H, weekly, top-up, warnings and privacy-safe cross-capability request history'
  );

  ({ res, reads } =
    await request({
      authenticated: false
    }));

  assert.equal(res.statusCode, 401);
  assert.equal(reads.length, 0);

  ({ res, reads } =
    await request({
      who: null
    }));

  assert.equal(res.statusCode, 401);
  assert.equal(reads.length, 0);

  console.log(
    'PASS: unauthenticated/missing identity cannot read account usage'
  );

  ({ res } =
    await request({
      profileError: true
    }));

  assert.equal(res.statusCode, 503);
  assert.equal(
    res.body.topupCredits,
    undefined
  );

  ({ res } =
    await request({
      historyError: true
    }));

  assert.equal(res.body.topupCredits, 9);
  assert.equal(
    res.body.recentRequestsAvailable,
    false
  );
  assert.deepEqual(
    res.body.recentRequests,
    []
  );

  console.log(
    'PASS: unavailable history never fabricates zero balances and valid balances remain visible'
  );

  const start =
    '2026-09-09T01:00:00Z';
  const end =
    '2026-09-09T06:00:00Z';

  assert.equal(
    windowSummary(
      10,
      3,
      start,
      end,
      time
    ).remaining,
    7
  );
  assert.equal(
    windowSummary(
      10,
      3,
      start,
      end,
      Date.parse(end)
    ).state,
    'expired'
  );
  assert.equal(
    windowSummary(
      10,
      3,
      start,
      end,
      Date.parse(end)
    ).remaining,
    null
  );
  assert.equal(
    windowSummary(
      null,
      0,
      null,
      null,
      time
    ).state,
    'unconfigured'
  );

  const record =
    publicUsageRecord(historyRows[0]);

  assert.equal(record.capability, 'chat');
  assert.equal(record.usageKind, 'chat_request');
  assert.equal(record.creditsCharged, 1);
  assert.equal(record.fundingSource, 'subscription');
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      record,
      'provider'
    ),
    false
  );

  console.log(
    'PASS: request-history whitelist excludes provider/model/cost/prompt fields'
  );

  const src = fs.readFileSync(
    path.join(
      __dirname,
      '../frontend/zuvyr-suite-v1.js'
    ),
    'utf8'
  );

  const startMarker =
    src.indexOf('  // Usage UI 18:');
  const endMarker =
    src.indexOf(
      '  function genericView(id)',
      startMarker
    );

  assert(startMarker >= 0);
  assert(endMarker > startMarker);

  const fragment =
    src.slice(startMarker, endMarker);

  const box = {
    innerHTML: '',
    textContent: '',
    querySelector() {
      return {
        onclick: null,
        click() {}
      };
    }
  };
  const button = {};
  const title = {};
  const intro = {};
  const view = {
    querySelector(selector) {
      if (
        selector ===
        '[data-zs-usage-content]'
      ) {
        return box;
      }
      if (
        selector ===
        '[data-zs-usage-refresh]'
      ) {
        return button;
      }
      if (selector === 'h1') {
        return title;
      }
      return intro;
    }
  };

  const success =
    (await request()).res.body;

  const context = {
    console,
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    Number,
    session: {
      user: {
        id: owner
      }
    },
    language: () => 'en',
    suite: {
      querySelector: () => view
    },
    esc: value =>
      String(
        value == null ? '' : value
      ).replace(
        /[&<>"']/g,
        char => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        })[char]
      ),
    document: {
      documentElement: {
        lang: 'en'
      },
      getElementById() {
        return {
          click() {}
        };
      }
    },
    window: {
      getZuvyrUnifiedUsageSummary:
        async () => success
    }
  };

  vm.createContext(context);
  vm.runInContext(fragment, context);

  await context.loadUsage();

  assert.equal(
    vm.runInContext('usageState', context),
    'loaded'
  );
  assert(
    box.innerHTML.includes(
      '<strong>PRO</strong>'
    )
  );
  assert(
    box.innerHTML.includes(
      '10 / 100 remaining'
    )
  );
  assert(
    box.innerHTML.includes(
      '<strong>9</strong>'
    )
  );
  assert(
    box.innerHTML.includes(
      'Recent requests'
    )
  );
  assert(
    box.innerHTML.includes(
      'CHAT'
    )
  );
  assert(
    box.innerHTML.includes(
      'Upgrade plan'
    )
  );
  assert(
    box.innerHTML.includes(
      'Buy top-up credits'
    )
  );
  assert(
    box.innerHTML.includes(
      '5H capacity is at or below 10%'
    )
  );

  let resolveFirst;

  context.window
    .getZuvyrUnifiedUsageSummary =
    () =>
      new Promise(resolve => {
        resolveFirst = resolve;
      });

  const first = context.loadUsage(true);

  context.session = {
    user: {
      id: 'other-user'
    }
  };

  context.clearUsage();
  resolveFirst(success);
  await first;

  assert.equal(
    vm.runInContext('usageData', context),
    null
  );
  assert.notEqual(
    vm.runInContext('usageState', context),
    'loaded'
  );

  context.window
    .getZuvyrUnifiedUsageSummary =
    async () => {
      throw new Error('offline');
    };

  await context.loadUsage(true);

  assert.equal(
    vm.runInContext('usageState', context),
    'error'
  );
  assert.equal(
    vm.runInContext('usageData', context),
    null
  );
  assert(
    box.textContent.includes(
      'Could not load'
    )
  );

  console.log(
    'PASS: Usage/Billing UI uses the shared source, renders required Pack018 fields, rejects stale account responses and fails closed'
  );

  console.log(
    'USAGE UI TEST GROUPS: 6. No live database, provider or payment calls.'
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
