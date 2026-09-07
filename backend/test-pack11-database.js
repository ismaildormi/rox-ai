'use strict';
const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'38_zuvyr_unified_product_orchestration.sql'),'utf8').toLowerCase();
for(const table of ['zuvyr_orchestration_proposals','zuvyr_orchestration_steps','zuvyr_orchestration_approvals','zuvyr_capability_handoffs','zuvyr_ip_tool_grants']) { assert(sql.includes(`create table if not exists public.${table}`)); assert(sql.includes(`alter table public.${table} enable row level security`)); }
assert(sql.includes('check (execution_enabled = false)')); assert(sql.includes('check (provider_calls_made = false)')); assert(sql.includes("not ('*' = any(scopes))")); assert(sql.includes('from public, anon, authenticated'));
console.log('PASS: Pack 11 additive RLS schema keeps execution, provider calls and wildcard IP scopes blocked');
