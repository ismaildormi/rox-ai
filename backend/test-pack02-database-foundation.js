'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '29_zuvyr_intelligence_task_foundation.sql'), 'utf8');
for (const needle of [
  'create table if not exists public.zuvyr_task_runs',
  'create table if not exists public.zuvyr_task_steps',
  'constraint zuvyr_task_runs_idempotency_unique unique (user_id, idempotency_key)',
  "check (state in ('pending', 'running', 'succeeded', 'failed', 'cancelled'))",
  'references public.zuvyr_usage_records(id) on delete restrict',
  'alter table public.zuvyr_task_runs enable row level security',
  'alter table public.zuvyr_task_steps enable row level security',
  'revoke all on table public.zuvyr_task_runs from public, anon, authenticated',
  'revoke all on table public.zuvyr_task_steps from public, anon, authenticated',
  'to service_role'
]) assert(sql.includes(needle), `Missing SQL safety contract: ${needle}`);

assert(!/\b(drop table|truncate|delete from)\b/i.test(sql));
assert(!/grant\s+.*\s+to\s+(anon|authenticated)/i.test(sql));

console.log('PASS: Pack 02 additive, RLS-protected, service-role-only task schema');
