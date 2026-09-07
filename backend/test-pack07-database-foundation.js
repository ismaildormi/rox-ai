'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname, '34_zuvyr_voice_music_audio_foundation.sql'), 'utf8');

for (const marker of [
  'create table if not exists public.audio_jobs',
  'create table if not exists public.audio_artifacts',
  'create table if not exists public.voice_sessions',
  "status text not null default 'blocked'",
  "pricing_status text not null default 'unpriced'",
  'continuous_listening = false',
  'background_recording = false',
  'store_raw_audio = false',
  'visible_indicator = true',
  'stop_control = true',
  'enable row level security'
]) assert(sql.includes(marker), `Missing SQL marker: ${marker}`);
assert(!/\b(drop table|truncate|delete from)\b/i.test(sql));
assert(!/grant\s+.*\s+to\s+(anon|authenticated)/i.test(sql));
assert(!/create\s+policy/i.test(sql));
console.log('PASS: Pack 07 additive RLS Voice/Music/Audio schema with privacy defaults');
