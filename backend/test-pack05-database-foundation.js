'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname, '32_zuvyr_video_jobs_operations_foundation.sql'), 'utf8');

for (const marker of [
  'alter table public.generation_jobs',
  'add column if not exists video_operation',
  'add column if not exists source_image_asset_id',
  'add column if not exists source_video_asset_id',
  'add column if not exists progress_percent',
  'add column if not exists cancel_requested',
  'generation_jobs_video_operation_allowed',
  'generation_jobs_progress_valid',
  'generation_jobs_video_urls_https',
  'generation_jobs_user_video_history_idx'
]) assert(sql.includes(marker), `Missing SQL marker: ${marker}`);
assert(!/\b(drop table|truncate|delete from)\b/i.test(sql));
assert(!/grant\s+.*\s+to\s+(anon|authenticated)/i.test(sql));

console.log('PASS: Pack 05 additive Video jobs, lineage, progress and preview schema');
