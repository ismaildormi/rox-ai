-- ZUVYR V1 Pack 09: unified Workspace, projects, creation tools, templates,
-- scheduled tasks, plugins, integrations and workflows foundation.
-- Additive only. External connections, publishing and background execution stay disabled.

create table if not exists public.workspace_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  shared_context_enabled boolean not null default false,
  external_sharing_enabled boolean not null default false check (external_sharing_enabled = false),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('chat','file','image','video','audio','code','document','spreadsheet','presentation','task')),
  name text not null check (char_length(name) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  source_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_project_items (
  project_id uuid not null references public.workspace_projects(id) on delete cascade,
  item_id uuid not null references public.workspace_items(id) on delete cascade,
  position integer not null default 0 check (position >= 0),
  added_at timestamptz not null default now(),
  primary key (project_id, item_id)
);

create table if not exists public.workspace_creations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid references public.workspace_items(id) on delete set null,
  kind text not null check (kind in ('document','spreadsheet','presentation')),
  content jsonb not null check (jsonb_typeof(content) in ('object','array','string')),
  generated boolean not null default false check (generated = false),
  external_exported boolean not null default false check (external_exported = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  category text not null check (char_length(category) between 1 and 60),
  body text not null check (char_length(body) between 1 and 200000),
  variables text[] not null default '{}',
  scripts_allowed boolean not null default false check (scripts_allowed = false),
  community_published boolean not null default false check (community_published = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_workflows (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  execution_enabled boolean not null default false check (execution_enabled = false),
  external_writes_enabled boolean not null default false check (external_writes_enabled = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workspace_workflows(id) on delete cascade,
  step_key text not null check (step_key ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'),
  position integer not null check (position between 0 and 19),
  capability text not null check (capability in ('chat','image','video','audio','code','research','document','spreadsheet','presentation','export')),
  depends_on text[] not null default '{}',
  execution_enabled boolean not null default false check (execution_enabled = false),
  unique (workflow_id, step_key),
  unique (workflow_id, position)
);

create table if not exists public.workspace_schedules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  workflow_id uuid not null references public.workspace_workflows(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  schedule_type text not null check (schedule_type in ('once','recurring')),
  run_at timestamptz not null,
  interval_minutes integer check (interval_minutes is null or interval_minutes between 60 and 525600),
  timezone text not null check (char_length(timezone) between 1 and 64),
  state text not null default 'draft' check (state in ('draft','paused','cancelled')),
  execution_enabled boolean not null default false check (execution_enabled = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_plugin_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  plugin_key text not null,
  scopes text[] not null check (cardinality(scopes) between 1 and 12 and not ('*' = any(scopes))),
  explicit_consent boolean not null check (explicit_consent = true),
  installed boolean not null default false check (installed = false),
  runtime_enabled boolean not null default false check (runtime_enabled = false),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_integration_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  integration_key text not null check (integration_key in ('google_drive')),
  scopes text[] not null check (cardinality(scopes) between 1 and 12 and not ('*' = any(scopes))),
  explicit_consent boolean not null check (explicit_consent = true),
  connected boolean not null default false check (connected = false),
  read_enabled boolean not null default false check (read_enabled = false),
  write_enabled boolean not null default false check (write_enabled = false),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_audit_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.workspace_projects(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  external_write_executed boolean not null default false check (external_write_executed = false),
  created_at timestamptz not null default now()
);

create index if not exists workspace_projects_owner_updated_idx on public.workspace_projects(owner_id, updated_at desc);
create index if not exists workspace_items_owner_kind_updated_idx on public.workspace_items(owner_id, kind, updated_at desc);
create index if not exists workspace_project_items_project_position_idx on public.workspace_project_items(project_id, position);
create index if not exists workspace_templates_owner_category_idx on public.workspace_templates(owner_id, category, updated_at desc);
create index if not exists workspace_schedules_owner_run_idx on public.workspace_schedules(owner_id, state, run_at);
create index if not exists workspace_audit_owner_created_idx on public.workspace_audit_events(owner_id, created_at desc);

alter table public.workspace_projects enable row level security;
alter table public.workspace_items enable row level security;
alter table public.workspace_project_items enable row level security;
alter table public.workspace_creations enable row level security;
alter table public.workspace_templates enable row level security;
alter table public.workspace_workflows enable row level security;
alter table public.workspace_workflow_steps enable row level security;
alter table public.workspace_schedules enable row level security;
alter table public.workspace_plugin_connections enable row level security;
alter table public.workspace_integration_connections enable row level security;
alter table public.workspace_audit_events enable row level security;

revoke all on public.workspace_projects, public.workspace_items, public.workspace_project_items,
  public.workspace_creations, public.workspace_templates, public.workspace_workflows,
  public.workspace_workflow_steps, public.workspace_schedules, public.workspace_plugin_connections,
  public.workspace_integration_connections, public.workspace_audit_events from anon, authenticated;

comment on table public.workspace_schedules is 'Pack 09 validation foundation only; no background execution is activated.';
comment on table public.workspace_integration_connections is 'OAuth credentials are never stored in workspace rows; Google Drive remains disconnected.';
