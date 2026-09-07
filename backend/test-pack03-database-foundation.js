'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname, '30_zuvyr_chat_sources_research_foundation.sql'), 'utf8');

for (const marker of [
  'create table if not exists public.conversation_sources',
  'create table if not exists public.zuvyr_chat_capability_runs',
  "source_type in ('file', 'web', 'product', 'memory')",
  "mode in ('web_search', 'deep_research', 'shopping')",
  'references public.zuvyr_usage_records(id) on delete restrict',
  'alter table public.conversation_sources enable row level security',
  'alter table public.zuvyr_chat_capability_runs enable row level security',
  'revoke all on table public.conversation_sources from public, anon, authenticated',
  'to service_role'
]) assert(sql.includes(marker), `Missing SQL marker: ${marker}`);
assert(!/\b(drop table|truncate|delete from)\b/i.test(sql));
assert(!/grant\s+.*\s+to\s+(anon|authenticated)/i.test(sql));

console.log('PASS: Pack 03 additive, RLS-protected and service-role-only Chat source schema');
