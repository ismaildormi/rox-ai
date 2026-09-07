'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname, '31_zuvyr_image_operations_history_foundation.sql'), 'utf8');

for (const marker of [
  'alter table public.generation_jobs',
  'add column if not exists image_operation',
  'add column if not exists reference_asset_ids',
  'references public.conversation_assets(id) on delete set null',
  'generation_jobs_image_operation_allowed',
  'generation_jobs_reference_assets_array',
  'generation_jobs_user_image_history_idx'
]) assert(sql.includes(marker), `Missing SQL marker: ${marker}`);
assert(!/\b(drop table|truncate|delete from)\b/i.test(sql));
assert(!/grant\s+.*\s+to\s+(anon|authenticated)/i.test(sql));

console.log('PASS: Pack 04 additive image job lineage and history schema');
