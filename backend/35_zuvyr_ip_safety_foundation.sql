-- ZUVYR V1 Pack 08: ZUVYR IP permissions, confirmations, audit, STOP and undo foundation.
-- Additive only. No trusted device agent or computer-control execution is activated.

create table if not exists public.ip_devices (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null, status text not null default 'disabled' check (status in ('disabled','pending_pairing','paired','revoked')),
  public_key_fingerprint text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.ip_sessions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.ip_devices(id) on delete cascade,
  state text not null default 'blocked' check (state in ('blocked','ready','running','stopping','stopped','failed')),
  execution_enabled boolean not null default false check (execution_enabled = false),
  sandbox_id text, started_at timestamptz, stopped_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.ip_permission_grants (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references public.ip_sessions(id) on delete cascade,
  scopes text[] not null check (cardinality(scopes) between 1 and 9 and not ('*' = any(scopes))),
  explicit_consent boolean not null check (explicit_consent = true), issued_at timestamptz not null, expires_at timestamptz not null,
  revoked_at timestamptz, created_at timestamptz not null default now(), check (expires_at > issued_at)
);
create table if not exists public.ip_plans (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid references public.ip_sessions(id) on delete cascade, goal text not null check (char_length(goal) between 1 and 2000),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'), executable boolean not null default false check (executable = false), created_at timestamptz not null default now()
);
create table if not exists public.ip_actions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references public.ip_sessions(id) on delete cascade, plan_id uuid references public.ip_plans(id) on delete set null,
  action_type text not null check (action_type in ('observe_screen','move_pointer','click','type_text','open_application','read_clipboard','write_clipboard','read_file','write_file','run_command')),
  required_scope text not null, risk text not null check (risk in ('low','medium','high','critical')),
  status text not null default 'blocked' check (status in ('blocked','pending_confirmation','ready','running','completed','failed','cancelled')),
  action_digest text not null check (action_digest ~ '^[0-9a-f]{64}$'), device_action_executed boolean not null default false check (device_action_executed = false),
  created_at timestamptz not null default now(), completed_at timestamptz
);
create table if not exists public.ip_confirmations (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references public.ip_sessions(id) on delete cascade, action_id uuid not null references public.ip_actions(id) on delete cascade,
  action_digest text not null check (action_digest ~ '^[0-9a-f]{64}$'), state text not null default 'pending' check (state in ('pending','approved','denied','expired','consumed')),
  expires_at timestamptz not null, resolved_at timestamptz, consumed_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.ip_audit_events (
  id bigint generated always as identity primary key, owner_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid references public.ip_sessions(id) on delete cascade, action_id uuid references public.ip_actions(id) on delete set null,
  event_type text not null, details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'), created_at timestamptz not null default now()
);
create table if not exists public.ip_stop_signals (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references public.ip_sessions(id) on delete cascade, status text not null default 'accepted' check (status in ('accepted','delivered','acknowledged')),
  device_command_sent boolean not null default false check (device_command_sent = false), created_at timestamptz not null default now(), acknowledged_at timestamptz
);
create table if not exists public.ip_undo_receipts (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references public.ip_sessions(id) on delete cascade, action_id uuid not null references public.ip_actions(id) on delete cascade,
  backup_artifact_id uuid not null references public.conversation_assets(id) on delete restrict,
  status text not null default 'blocked' check (status in ('blocked','pending_confirmation','ready','running','completed','failed')),
  device_action_executed boolean not null default false check (device_action_executed = false), created_at timestamptz not null default now(), completed_at timestamptz
);

create index if not exists ip_sessions_owner_created_idx on public.ip_sessions(owner_id,created_at desc);
create index if not exists ip_actions_session_created_idx on public.ip_actions(session_id,created_at);
create index if not exists ip_confirmations_pending_idx on public.ip_confirmations(owner_id,state,expires_at);
create index if not exists ip_audit_session_created_idx on public.ip_audit_events(session_id,created_at);
create index if not exists ip_stop_session_created_idx on public.ip_stop_signals(session_id,created_at desc);

alter table public.ip_devices enable row level security;
alter table public.ip_sessions enable row level security;
alter table public.ip_permission_grants enable row level security;
alter table public.ip_plans enable row level security;
alter table public.ip_actions enable row level security;
alter table public.ip_confirmations enable row level security;
alter table public.ip_audit_events enable row level security;
alter table public.ip_stop_signals enable row level security;
alter table public.ip_undo_receipts enable row level security;

comment on table public.ip_sessions is 'Pack 08 foundation only; execution is constrained false until a trusted sandboxed device agent exists.';
comment on table public.ip_audit_events is 'Append-only audit foundation; secrets must be redacted before service-role insertion.';
