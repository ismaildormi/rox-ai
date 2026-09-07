'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname, '37_zuvyr_final_product_readiness.sql'), 'utf8');
const tables = ['zuvyr_user_preferences','zuvyr_notifications','zuvyr_usage_daily_rollups','zuvyr_financial_daily_rollups','zuvyr_data_rights_requests','zuvyr_release_validations','zuvyr_app_release_candidates'];
for (const table of tables) {
  assert(sql.includes(`create table if not exists public.${table}`), `Missing table ${table}`);
  assert(sql.includes(`alter table public.${table} enable row level security`), `Missing RLS ${table}`);
}
for (const constraint of ['voice_continuous_listening = false','vision_continuous_capture = false','external_data_sharing = false','delivered_externally = false','executed = false','build_ready = false','store_submitted = false','production_deployed = false']) assert(sql.includes(constraint), `Missing fail-closed constraint ${constraint}`);
assert(sql.includes('revoke all on public.zuvyr_user_preferences'));
assert(!/drop\s+(table|column)|truncate|delete\s+from/i.test(sql));
assert(!/(access_token|refresh_token|oauth_token|client_secret|api_key|raw_prompt)/i.test(sql));
console.log('PASS: Pack 10 additive RLS preferences, notifications, analytics, rights and release schema');
