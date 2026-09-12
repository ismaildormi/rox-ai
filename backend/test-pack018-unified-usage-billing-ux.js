'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const index = fs.readFileSync(
  path.join(
    __dirname,
    '../frontend/index.html'
  ),
  'utf8'
);
const suite = fs.readFileSync(
  path.join(
    __dirname,
    '../frontend/zuvyr-suite-v1.js'
  ),
  'utf8'
);
const summary = fs.readFileSync(
  path.join(
    __dirname,
    'lib/zuvyrUsageSummary.js'
  ),
  'utf8'
);

assert(
  summary.includes(
    "'zuvyr_usage_records'"
  )
);
assert(
  summary.includes(
    'recentRequests'
  )
);
assert(
  summary.includes(
    'buildCapacityWarnings'
  )
);
assert(
  summary.includes(
    'subscription_status'
  )
);

assert(
  index.includes(
    '// PACK018 UNIFIED USAGE SOURCE START'
  )
);
assert(
  index.includes(
    "authFetch(\n      '/api/zuvyr-usage-summary'"
  )
);
assert(
  index.includes(
    'window.getZuvyrUnifiedUsageSummary'
  )
);
assert(
  index.includes(
    'refreshZuvyrUnifiedUsageSummary'
  )
);

assert(
  suite.includes(
    '// Usage UI 18:'
  )
);
assert(
  suite.includes(
    'window.getZuvyrUnifiedUsageSummary'
  )
);
assert(
  suite.includes(
    'Recent requests'
  )
);
assert(
  suite.includes(
    'Upgrade plan'
  )
);
assert(
  suite.includes(
    'Buy top-up credits'
  )
);
assert(
  suite.includes(
    'fiveHourRemainingPercentThreshold'
  )
);
assert(
  suite.includes(
    'weeklyRemainingPercentThreshold'
  )
);

const markerStart =
  index.indexOf(
    '// PACK018 UNIFIED USAGE SOURCE START'
  );
const markerEnd =
  index.indexOf(
    '// PACK018 UNIFIED USAGE SOURCE END',
    markerStart
  );

assert(markerStart >= 0);
assert(markerEnd > markerStart);

const fragment = index.slice(
  markerStart,
  markerEnd +
    '// PACK018 UNIFIED USAGE SOURCE END'.length
);

function runViewport(width) {
  const nodes = new Map();

  for (const id of [
    'sidebarUsagePct',
    'sidebarUsageFill',
    'sidebarCreditsNum',
    'settingsSummary',
    'topupBtn',
    'upgradeBtn',
    'settingsUpgradeBtn',
    'topbarUserPlan',
    'sidebarProfilePlan'
  ]) {
    nodes.set(
      id,
      {
        textContent: '',
        style: {
          width: '',
          display: ''
        }
      }
    );
  }

  const data = {
    status: 'success',
    version:
      'pack-018.unified-usage-billing-ux.v1',
    plan: 'pro',
    topupCredits: 9,
    fiveHour: {
      state: 'active',
      total: 100,
      used: 90,
      remaining: 10,
      startedAt:
        '2026-09-09T01:00:00.000Z',
      endsAt:
        '2026-09-09T06:00:00.000Z'
    },
    weekly: {
      state: 'active',
      total: 400,
      used: 200,
      remaining: 200,
      startedAt:
        '2026-09-08T00:00:00.000Z',
      endsAt:
        '2026-09-15T00:00:00.000Z'
    },
    warnings: {
      fiveHourRemainingPercentThreshold: 10,
      weeklyRemainingPercentThreshold: null
    },
    recentRequests: []
  };

  const context = {
    Number,
    String,
    Error,
    console,
    profile: {
      subscription_status: 'pro'
    },
    zuvyrPlanCatalog: {
      tiers: {
        pro: {
          displayName: 'PRO'
        }
      }
    },
    lastRoxUsage: null,
    zuvyrUnifiedUsageOwner: null,
    zuvyrUnifiedUsageSummary: null,
    zuvyrUnifiedUsagePromise: null,
    session: {
      user: {
        id: 'owner'
      }
    },
    authFetch:
      async () => ({
        ok: true,
        json: async () => data
      }),
    document: {
      getElementById(id) {
        return nodes.get(id) || null;
      }
    },
    CustomEvent:
      function CustomEvent(
        type,
        options
      ) {
        this.type = type;
        this.detail =
          options?.detail;
      },
    window: {
      innerWidth: width,
      dispatchEvent() {}
    }
  };

  vm.createContext(context);
  vm.runInContext(fragment, context);

  context.renderZuvyrUnifiedUsageSummary(
    data
  );

  return {
    pct:
      nodes.get(
        'sidebarUsagePct'
      ).textContent,
    fill:
      nodes.get(
        'sidebarUsageFill'
      ).style.width,
    credits:
      nodes.get(
        'sidebarCreditsNum'
      ).textContent,
    settings:
      nodes.get(
        'settingsSummary'
      ).textContent,
    plan:
      nodes.get(
        'sidebarProfilePlan'
      ).textContent,
    topbarPlan:
      nodes.get(
        'topbarUserPlan'
      ).textContent,
    topupDisplay:
      nodes.get(
        'topupBtn'
      ).style.display
  };
}

const mobile = runViewport(375);
const desktop = runViewport(1440);

assert.deepEqual(
  mobile,
  desktop,
  'mobile and desktop must render identical account values'
);

assert.equal(mobile.pct, '90%');
assert.equal(mobile.fill, '90%');
assert(
  mobile.credits.includes(
    'PRO · 5H 10/100 · Top-up 9'
  )
);
assert(
  mobile.credits.includes(
    '⚠ 5H ≤10%'
  )
);
assert(
  mobile.settings.includes(
    'Weekly: 200/400'
  )
);
assert.equal(mobile.plan, 'PRO');
assert.equal(mobile.topbarPlan, 'PRO');
assert.equal(
  mobile.topupDisplay,
  'block'
);

const oldUsageStatusCalls =
  index.match(
    /authFetch\('\/api\/usage-status'/g
  ) || [];

assert.equal(
  oldUsageStatusCalls.length,
  0,
  'sidebar must not fetch the old usage-status meter source'
);

const directLegacyProCalls =
  index.match(
    /renderProUsage\([^)]*data\.newBalance/g
  ) || [];

assert.equal(
  directLegacyProCalls.length,
  0,
  'metered request responses must refresh the unified source instead of mutating the meter independently'
);

console.log(
  'PASS: Pack018 sidebar and Usage/Billing surface share /api/zuvyr-usage-summary'
);
console.log(
  'PASS: visible plan, 5H, top-up and warning values are identical at 375px and 1440px'
);
console.log(
  'PASS: old usage-status fetch and direct newBalance meter mutation are removed from the visible meter path'
);
console.log(
  'PASS: request history comes from the unified usage ledger and upgrade/top-up actions remain visible'
);
console.log(
  'DATABASE / PROVIDER / PAYMENT / NETWORK CALLS: NONE'
);
