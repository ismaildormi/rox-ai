-- ZUVYR V1 Pack 07: Voice, music, audio and audio-to-video foundation.
-- Additive only. All provider operations remain blocked until pricing and settlement are verified.

create table if not exists public.audio_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  request_id text not null unique,
  operation text not null check (operation in ('transcription','text_to_speech','voice_chat','music_generation','sound_effects','audio_cleanup','remix','stem_separation','translate_dub','audio_to_video')),
  source_audio_asset_id uuid references public.conversation_assets(id) on delete set null,
  options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  status text not null default 'blocked' check (status in ('blocked','queued','processing','done','failed','cancelled')),
  stage text not null default 'blocked' check (stage in ('blocked','validating','provider','processing','rendering','settling','done','failed','cancelled')),
  progress_percent smallint not null default 0 check (progress_percent between 0 and 100),
  pricing_status text not null default 'unpriced' check (pricing_status in ('unpriced','verified')),
  reservation_request_id text,
  reserved_credits bigint check (reserved_credits is null or reserved_credits >= 0),
  final_credits bigint check (final_credits is null or final_credits >= 0),
  provider text,
  model text,
  usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object'),
  result_url text check (result_url is null or result_url like 'https://%'),
  preview_url text check (preview_url is null or preview_url like 'https://%'),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.audio_artifacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid not null references public.audio_jobs(id) on delete cascade,
  asset_type text not null check (asset_type in ('audio','music','transcript','video')),
  url text not null check (url like 'https://%'),
  mime_type text not null,
  duration_seconds numeric check (duration_seconds is null or duration_seconds > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists public.voice_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  state text not null default 'blocked' check (state in ('blocked','ready','listening','processing','speaking','stopped','failed')),
  microphone_consent boolean not null default false,
  continuous_listening boolean not null default false check (continuous_listening = false),
  background_recording boolean not null default false check (background_recording = false),
  store_raw_audio boolean not null default false check (store_raw_audio = false),
  visible_indicator boolean not null default true check (visible_indicator = true),
  stop_control boolean not null default true check (stop_control = true),
  max_seconds integer not null default 300 check (max_seconds between 1 and 900),
  started_at timestamptz,
  stopped_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists audio_jobs_owner_created_idx on public.audio_jobs (owner_id, created_at desc);
create index if not exists audio_jobs_operation_status_idx on public.audio_jobs (operation, status, created_at desc);
create index if not exists audio_artifacts_owner_created_idx on public.audio_artifacts (owner_id, created_at desc);
create index if not exists voice_sessions_owner_created_idx on public.voice_sessions (owner_id, created_at desc);

alter table public.audio_jobs enable row level security;
alter table public.audio_artifacts enable row level security;
alter table public.voice_sessions enable row level security;

comment on table public.audio_jobs is 'Pack 07 service-role foundation; unpriced provider jobs remain blocked before reservation.';
comment on table public.voice_sessions is 'Explicit-consent voice session foundation; continuous/background recording and raw-audio retention are disabled.';
