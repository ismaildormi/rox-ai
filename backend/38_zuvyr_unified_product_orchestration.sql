-- ZUVYR V1 Pack 11: unified interfaces and cross-feature orchestration foundation.
-- Additive and fail-closed. Planning records cannot execute providers, spend credits,
-- install plugins, schedule work or control devices.

create table if not exists public.zuvyr_orchestration_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  goal text not null check (char_length(goal) between 3 and 4000),
  requested_outputs text[] not null check (cardinality(requested_outputs) between 1 and 8),
  additional_creation_consent boolean not null default false,
  state text not null default 'proposal' check (state in ('proposal','approved','cancelled')),
  execution_enabled boolean not null default false check (execution_enabled = false),
  provider_calls_made boolean not null default false check (provider_calls_made = false),
  credits_reserved boolean not null default false check (credits_reserved = false),
  created_at timestamptz not null default now()
);

create table if not exists public.zuvyr_orchestration_steps (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.zuvyr_orchestration_proposals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  step_order smallint not null check (step_order between 1 and 50),
  capability text not null,
  title text not null check (char_length(title) between 1 and 240),
  depends_on uuid[] not null default '{}',
  state text not null default 'proposed' check (state in ('proposed','cancelled')),
  execution_enabled boolean not null default false check (execution_enabled = false),
  unique (proposal_id, step_order)
);

create table if not exists public.zuvyr_orchestration_approvals (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.zuvyr_orchestration_proposals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  approved_outputs text[] not null,
  credit_reservation_confirmed boolean not null check (credit_reservation_confirmed = true),
  execution_enabled boolean not null default false check (execution_enabled = false),
  created_at timestamptz not null default now()
);

create table if not exists public.zuvyr_capability_handoffs (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.zuvyr_orchestration_proposals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  from_capability text not null,
  to_capability text not null,
  payload_reference text,
  approved boolean not null default false,
  delivered boolean not null default false check (delivered = false),
  created_at timestamptz not null default now()
);

create table if not exists public.zuvyr_ip_tool_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  goal text not null check (char_length(goal) between 3 and 4000),
  scopes text[] not null check (cardinality(scopes) between 1 and 30 and not ('*' = any(scopes))),
  explicit_consent boolean not null check (explicit_consent = true),
  execution_enabled boolean not null default false check (execution_enabled = false),
  device_control_enabled boolean not null default false check (device_control_enabled = false),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists zuvyr_orchestration_owner_created_idx on public.zuvyr_orchestration_proposals(owner_id, created_at desc);
create index if not exists zuvyr_orchestration_steps_proposal_idx on public.zuvyr_orchestration_steps(proposal_id, step_order);
create index if not exists zuvyr_handoffs_proposal_idx on public.zuvyr_capability_handoffs(proposal_id, created_at);
create index if not exists zuvyr_ip_grants_owner_created_idx on public.zuvyr_ip_tool_grants(owner_id, created_at desc);

alter table public.zuvyr_orchestration_proposals enable row level security;
alter table public.zuvyr_orchestration_steps enable row level security;
alter table public.zuvyr_orchestration_approvals enable row level security;
alter table public.zuvyr_capability_handoffs enable row level security;
alter table public.zuvyr_ip_tool_grants enable row level security;

revoke all on public.zuvyr_orchestration_proposals, public.zuvyr_orchestration_steps,
  public.zuvyr_orchestration_approvals, public.zuvyr_capability_handoffs,
  public.zuvyr_ip_tool_grants from public, anon, authenticated;

comment on table public.zuvyr_orchestration_proposals is 'Planning-only Pack 11 proposals. Execution, provider calls and credit reservation remain disabled.';
comment on table public.zuvyr_ip_tool_grants is 'Exact consented planning scopes only. Wildcards and device control are disabled.';
