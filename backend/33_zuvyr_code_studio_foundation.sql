-- ZUVYR V1 Pack 06: isolated Code Studio files, versions and runtime-request foundation.
-- Additive only. Runtime execution, dependency installation and deployment remain disabled.

create table if not exists public.code_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  entry_file text,
  status text not null default 'active' check (status in ('active', 'archived')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.code_project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.code_projects(id) on delete cascade,
  path text not null check (char_length(path) between 1 and 240),
  content text not null check (octet_length(content) <= 524288),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  language text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, path)
);

create table if not exists public.code_project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.code_projects(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists public.code_runtime_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.code_projects(id) on delete cascade,
  operation text not null check (operation in ('terminal', 'run', 'dependencies', 'build', 'test')),
  status text not null default 'blocked' check (status in ('blocked', 'queued', 'running', 'succeeded', 'failed', 'cancelled')),
  confirmed_at timestamptz,
  sandbox_id text,
  limits jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.code_deploy_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.code_projects(id) on delete cascade,
  status text not null default 'blocked' check (status in ('blocked', 'confirmed', 'deploying', 'succeeded', 'failed', 'cancelled')),
  target text,
  confirmation_token_hash text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists code_projects_owner_updated_idx on public.code_projects (owner_id, updated_at desc);
create index if not exists code_project_files_project_path_idx on public.code_project_files (project_id, path);
create index if not exists code_project_versions_project_created_idx on public.code_project_versions (project_id, created_at desc);
create index if not exists code_runtime_jobs_owner_created_idx on public.code_runtime_jobs (owner_id, created_at desc);
create index if not exists code_deploy_requests_owner_created_idx on public.code_deploy_requests (owner_id, created_at desc);

alter table public.code_projects enable row level security;
alter table public.code_project_files enable row level security;
alter table public.code_project_versions enable row level security;
alter table public.code_runtime_jobs enable row level security;
alter table public.code_deploy_requests enable row level security;

comment on table public.code_runtime_jobs is
  'Pack 06 audit foundation only; no executor is configured or activated.';
comment on table public.code_deploy_requests is
  'Pack 06 explicit-confirmation foundation; deployment remains disabled.';
