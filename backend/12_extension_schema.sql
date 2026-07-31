-- ROX AI — 12_extension_schema.sql
-- Extensibility pass: run after 01–11 (in that numeric order).
--
-- Nothing in this file changes existing behavior. It only:
--   (a) adds NULLABLE columns to existing tables, so Teams/Orgs/Workspaces
--       can later scope rows by org/workspace without an ALTER TABLE on a
--       live, populated table — the ALTER already happened, today, while
--       the table is small and low-risk;
--   (b) creates skeleton tables for features that are flagged OFF (see
--       config/feature-flags.json) and have no application code reading
--       or writing them yet. Creating an empty table with RLS locked down
--       is free and reversible; retrofitting one under production load
--       later is not.
--
-- Every new table follows the same 3 conventions on purpose, so a future
-- feature never needs a schema redesign, only new rows/columns:
--   1. `metadata jsonb default '{}'`     — escape hatch for fields nobody
--      has thought of yet, without a migration.
--   2. `org_id uuid`, `workspace_id uuid` (nullable) — every future
--      "Teams/Orgs" scoping question is answered the same way everywhere.
--   3. `created_at` / `updated_at timestamptz default now()` — consistent
--      audit trail, needed by the future Admin/Analytics dashboards.

-- =========================================================================
-- (a) Forward-compat columns on EXISTING tables — additive, nullable, safe.
-- =========================================================================

alter table profiles
  add column if not exists org_id uuid,
  add column if not exists workspace_id uuid,
  add column if not exists preferred_locale text default 'ar',   -- multi_language_ui
  add column if not exists ui_theme text default 'system',        -- dark_mode / themes
  add column if not exists metadata jsonb default '{}'::jsonb;

alter table generation_jobs
  add column if not exists org_id uuid,
  add column if not exists workspace_id uuid;

alter table credit_audit_log
  add column if not exists org_id uuid;

-- =========================================================================
-- (b) Skeleton tables — one block per planned feature area. All locked
--     down with RLS (service-role only) until the owning feature flag is
--     turned on and real application code + narrower policies are added.
-- =========================================================================

-- --- Teams / Organizations / Workspaces -------------------------------
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references profiles(id) on delete restrict,
  plan text default 'org',            -- see config/plans.json tiers
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  name text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists workspace_members (
  workspace_id uuid references workspaces(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text default 'member',          -- 'owner' | 'admin' | 'member'
  created_at timestamptz default now(),
  primary key (workspace_id, user_id)
);

-- --- AI Agents / Personas / Prompt Library / Templates -----------------
create table if not exists ai_agents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade,
  org_id uuid references organizations(id),
  name text not null,
  system_prompt text,
  tool_keys text[] default '{}',        -- keys into the ai.tools registry
  model text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists ai_personas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade,
  org_id uuid references organizations(id),
  name text not null,
  system_prompt text not null,
  preferred_model text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists prompt_library (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade,
  org_id uuid references organizations(id),
  is_public boolean default false,      -- feeds community_templates when enabled
  title text not null,
  prompt_body text not null,
  category text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id),
  org_id uuid references organizations(id),
  is_public boolean default false,
  title text not null,
  body jsonb not null,                  -- structured template content
  category text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- --- Plugins / Extensions / Marketplace ---------------------------------
create table if not exists plugin_installations (
  id uuid primary key default gen_random_uuid(),
  plugin_key text not null,
  owner_id uuid references profiles(id) on delete cascade,
  org_id uuid references organizations(id),
  manifest jsonb not null,
  enabled boolean default true,
  created_at timestamptz default now()
);

-- --- Public API / Webhooks / SDK -----------------------------------------
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade,
  org_id uuid references organizations(id),
  key_hash text not null,               -- never store the raw key
  label text,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists webhooks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade,
  org_id uuid references organizations(id),
  url text not null,
  secret text not null,
  subscribed_events text[] default '{}',
  is_active boolean default true,
  created_at timestamptz default now()
);

-- --- Notifications --------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  channel text,                          -- 'push' | 'email' | 'in_app'
  title text,
  body text,
  read_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- --- Referral / Affiliate --------------------------------------------------
create table if not exists referral_codes (
  code text primary key,
  owner_id uuid references profiles(id) on delete cascade,
  reward_credits integer default 100,
  created_at timestamptz default now()
);

create table if not exists affiliate_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade,
  payout_email text,
  commission_rate numeric default 0.20,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- --- Shared Conversations / Projects / Version History --------------------
create table if not exists shared_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade,
  org_id uuid references organizations(id),
  share_token text unique,
  is_public boolean default false,
  content jsonb not null,
  created_at timestamptz default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade,
  org_id uuid references organizations(id),
  workspace_id uuid references workspaces(id),
  name text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  snapshot jsonb not null,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- --- Feature flag per-user/org overrides (used by src/core/featureFlags.js) --
create table if not exists feature_flag_overrides (
  flag_key text not null,
  user_id uuid references profiles(id) on delete cascade,
  org_id uuid references organizations(id) on delete cascade,
  enabled boolean not null,
  created_at timestamptz default now()
);

-- --- Analytics events (used by src/modules/analytics/events.js) -------------
create table if not exists analytics_events (
  id bigint generated always as identity primary key,
  event_name text not null,
  properties jsonb default '{}'::jsonb,
  user_id uuid references profiles(id),
  org_id uuid references organizations(id),
  created_at timestamptz default now()
);

-- =========================================================================
-- RLS: locked to service-role only for every new table above. Each
-- feature's own implementation pass should replace these with real
-- ownership-based policies (mirroring 02_rls_policies.sql) — this
-- default exists so an empty, flagged-off table is never accidentally
-- world-readable/writable the moment it's created.
-- =========================================================================
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'organizations','workspaces','workspace_members','ai_agents','ai_personas',
    'prompt_library','templates','plugin_installations','api_keys','webhooks',
    'notifications','referral_codes','affiliate_accounts','shared_conversations',
    'projects','project_versions','feature_flag_overrides','analytics_events'
  ])
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'drop policy if exists service_role_only on %I; create policy service_role_only on %I for all using (auth.role() = ''service_role'');',
      t, t
    );
  end loop;
end $$;
