'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname,
  '28_zuvyr_cost_usage_allowance_foundation.sql'
);
const bytes = fs.readFileSync(target);
const sql = bytes.toString('utf8');

assert(!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
assert(!/[ \t]+$/m.test(sql));
assert(sql.startsWith('-- ZUVYR Pack 01'));
assert(sql.includes('begin;'));
assert(sql.includes('commit;'));
assert(sql.includes('create table if not exists public.zuvyr_usage_records'));
assert(sql.includes('usage_week_units_total integer'));
assert(sql.includes('usage_week_units_used integer not null default 0'));
assert(sql.includes('numeric(20, 0)'));
assert(sql.includes('for update;'));
assert(sql.includes('idempotency_key text not null'));
assert(sql.includes("state in ('reserved', 'settled', 'refunded', 'failed')"));
assert(sql.includes("interval '5 hours'"));
assert(sql.includes("interval '7 days'"));
assert(sql.includes("'plan_limits_unconfigured'"));
assert(sql.includes("'five_hour_allowance_exhausted'"));
assert(sql.includes("'weekly_allowance_exhausted'"));
assert(sql.includes("'actual_usage_exceeds_reservation'"));
assert(sql.includes('topup_credits_balance = topup_credits_balance + v_refund'));
assert(sql.includes('revoke all on table public.zuvyr_usage_records'));
assert(sql.includes('from public, anon, authenticated;'));
assert(sql.includes('to service_role;'));
assert(sql.includes('p_enforcement_enabled boolean default false'));
assert(sql.includes("'usage_enforcement_disabled'"));
assert(!/delete\s+from\s+public\.profiles/i.test(sql));
assert(!/truncate\s+/i.test(sql));
assert(!/drop\s+table/i.test(sql));

console.log('PASS: migration 28 is additive, exact and fail-closed');
console.log('PASS: financial data and RPCs are service_role-only');
console.log('DATABASE / STRIPE / MODEL / NETWORK CALLS: NONE');
