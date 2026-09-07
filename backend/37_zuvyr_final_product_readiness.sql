-- ZUVYR V1 Pack 10: Final Product usage, analytics, settings, notifications,
-- privacy/data-rights and release-readiness foundation.
-- Additive only. It does not activate billing, launch, deployment or store submission.

create table if not exists public.zuvyr_user_preferences (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  interface_language text not null default 'auto' check (interface_language in ('auto','en','ar','fr','es','zh')),
  theme text not null default 'system' check (theme in ('system','dark','light')),
  response_length text not null default 'balanced' check (response_length in ('concise','balanced','detailed')),
  memory_enabled boolean not null default false,
  training_consent boolean not null default false,
  marketing_consent boolean not null default false,
  voice_continuous_listening boolean not null default false check (voice_continuous_listening = false),
  vision_continuous_capture boolean not null default false check (vision_continuous_capture = false),
  external_data_sharing boolean not null default false check (external_data_sharing = false),
  updated_at timestamptz not null default now()
);

create table if not exists public.zuvyr_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null check (notification_type in ('job_completed','limit_warning','limit_exhausted','payment_succeeded','payment_failed','scheduled_task','security_alert')),
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 1000),
  read_at timestamptz,
  delivered_externally boolean not null default false check (delivered_externally = false),
  created_at timestamptz not null default now()
);

create table if not exists public.zuvyr_usage_daily_rollups (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  usage_date date not null,
  capability text not null,
  provider text not null,
  model_tool text not null,
  surface text not null,
  request_count bigint not null default 0 check (request_count >= 0),
  credits_used bigint not null default 0 check (credits_used >= 0),
  provider_cost_microusd numeric(20,0) not null default 0 check (provider_cost_microusd >= 0),
  primary key (owner_id, usage_date, capability, provider, model_tool, surface)
);

create table if not exists public.zuvyr_financial_daily_rollups (
  rollup_date date not null,
  plan_id text not null,
  capability text not null,
  revenue_microusd numeric(20,0) not null default 0 check (revenue_microusd >= 0),
  cost_microusd numeric(20,0) not null default 0 check (cost_microusd >= 0),
  gross_profit_microusd numeric(20,0) not null default 0,
  gross_margin_bps integer check (gross_margin_bps is null or gross_margin_bps between -1000000 and 10000),
  request_count bigint not null default 0 check (request_count >= 0),
  primary key (rollup_date, plan_id, capability)
);

create table if not exists public.zuvyr_data_rights_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_type text not null check (request_type in ('export','delete')),
  explicit_confirmation boolean not null check (explicit_confirmation = true),
  state text not null default 'pending' check (state in ('pending','reviewing','cancelled')),
  executed boolean not null default false check (executed = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.zuvyr_release_validations (
  id uuid primary key default gen_random_uuid(),
  release_key text not null,
  gate_key text not null,
  evidence_reference text,
  passed boolean not null default false,
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (release_key, gate_key)
);

create table if not exists public.zuvyr_app_release_candidates (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('web','windows','android','ios')),
  version text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'),
  checks jsonb not null default '{}'::jsonb check (jsonb_typeof(checks) = 'object'),
  build_ready boolean not null default false check (build_ready = false),
  store_submitted boolean not null default false check (store_submitted = false),
  production_deployed boolean not null default false check (production_deployed = false),
  created_at timestamptz not null default now(),
  unique (platform, version)
);

create index if not exists zuvyr_notifications_owner_created_idx on public.zuvyr_notifications(owner_id, created_at desc);
create index if not exists zuvyr_usage_rollups_owner_date_idx on public.zuvyr_usage_daily_rollups(owner_id, usage_date desc);
create index if not exists zuvyr_financial_rollups_date_idx on public.zuvyr_financial_daily_rollups(rollup_date desc);
create index if not exists zuvyr_data_rights_owner_created_idx on public.zuvyr_data_rights_requests(owner_id, created_at desc);
create index if not exists zuvyr_release_validations_release_idx on public.zuvyr_release_validations(release_key, passed);

alter table public.zuvyr_user_preferences enable row level security;
alter table public.zuvyr_notifications enable row level security;
alter table public.zuvyr_usage_daily_rollups enable row level security;
alter table public.zuvyr_financial_daily_rollups enable row level security;
alter table public.zuvyr_data_rights_requests enable row level security;
alter table public.zuvyr_release_validations enable row level security;
alter table public.zuvyr_app_release_candidates enable row level security;

revoke all on public.zuvyr_user_preferences, public.zuvyr_notifications,
  public.zuvyr_usage_daily_rollups, public.zuvyr_financial_daily_rollups,
  public.zuvyr_data_rights_requests, public.zuvyr_release_validations,
  public.zuvyr_app_release_candidates from public, anon, authenticated;

comment on table public.zuvyr_release_validations is 'Evidence registry only; Pack 10 launch remains blocked until independently verified gates pass.';
comment on table public.zuvyr_app_release_candidates is 'Preparation foundation only; no build, deployment or store submission is performed.';
