'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname, '33_zuvyr_code_studio_foundation.sql'), 'utf8');

for (const marker of [
  'create table if not exists public.code_projects',
  'create table if not exists public.code_project_files',
  'create table if not exists public.code_project_versions',
  'create table if not exists public.code_runtime_jobs',
  'create table if not exists public.code_deploy_requests',
  "status text not null default 'blocked'",
  'octet_length(content) <= 524288',
  'enable row level security'
]) assert(sql.includes(marker), `Missing SQL marker: ${marker}`);
assert(!/\b(drop table|truncate|delete from)\b/i.test(sql));
assert(!/grant\s+.*\s+to\s+(anon|authenticated)/i.test(sql));
assert(!/create\s+policy/i.test(sql));
console.log('PASS: Pack 06 additive service-role-only Code Studio schema foundation');
