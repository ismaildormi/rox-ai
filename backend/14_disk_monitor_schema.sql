-- ROX AI — 14_disk_monitor_schema.sql
-- Schema for the Disk Space Monitor + automatic maintenance system.
-- Run after 01–13, in numeric order. Same conventions as
-- 13_advisor_optimizer_schema.sql: service-role-only RLS, jsonb escape
-- hatches, created_at everywhere.

-- ============================================================
-- 1. Settings — singleton row, same pattern as optimizer_settings.
--    thresholds/retention/auto_fix are all admin-editable from the
--    Admin Dashboard (PUT /api/v1/admin/disk/settings).
-- ============================================================
create table if not exists disk_monitor_settings (
  id boolean primary key default true check (id),  -- exactly one row
  thresholds jsonb not null default '{"warning": 75, "critical": 90, "emergency": 95}'::jsonb,
  auto_fix_enabled boolean not null default false,
  logs_retention_days int not null default 14,
  backup_retention_days int not null default 30,
  max_backups_kept int not null default 20,
  cache_max_age_hours int not null default 24,
  temp_max_age_hours int not null default 6,
  abnormal_growth_pct_24h numeric not null default 25, -- flag a category if it grew >X% in 24h
  updated_by uuid references profiles(id),
  updated_at timestamptz default now()
);

insert into disk_monitor_settings (id) values (true) on conflict (id) do nothing;

-- ============================================================
-- 2. Snapshots — one row per scan (see src/modules/diskMonitor).
--    History is what makes "detect abnormal storage growth" possible
--    at all: growth is a diff against a PREVIOUS snapshot, not a
--    single point-in-time number.
-- ============================================================
create table if not exists disk_usage_snapshots (
  id bigint generated always as identity primary key,
  captured_at timestamptz default now(),
  total_bytes bigint not null,
  used_bytes bigint not null,
  free_bytes bigint not null,
  used_pct numeric not null,
  categories jsonb not null default '{}'::jsonb,     -- {ollama: {...}, docker: {...}, logs: {...}, ...}
  largest_dirs jsonb not null default '[]'::jsonb,
  largest_files jsonb not null default '[]'::jsonb,
  health_level text not null,                        -- 'healthy' | 'warning' | 'critical' | 'emergency'
  metadata jsonb default '{}'::jsonb
);

create index if not exists idx_disk_snapshots_captured_at on disk_usage_snapshots(captured_at);

-- ============================================================
-- 3. Maintenance log — every cleanup action, automatic or manual.
--    Unlike optimizer_actions_log, most of these are NOT reversible
--    (a deleted log file or old backup can't be un-deleted) — the
--    honest substitute for "reversible" here is a complete manifest of
--    exactly what was removed, so an admin can always see precisely
--    what happened even though it can't be undone with one click.
-- ============================================================
create table if not exists disk_maintenance_log (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,          -- 'delete_temp' | 'delete_cache' | 'delete_old_logs' | 'compress_logs' |
                                       -- 'delete_old_backups' | 'keep_latest_backups' | 'docker_prune_images' |
                                       -- 'docker_prune_volumes' | 'remove_ollama_model' | 'optimize_database'
  description text not null,
  triggered_by text not null,         -- 'auto' | 'admin:<user_id>'
  destructive boolean not null default true,
  reversible boolean not null default false,
  bytes_freed bigint default 0,
  manifest jsonb default '[]'::jsonb, -- list of exact paths/models/files affected
  status text not null default 'completed', -- 'completed' | 'failed' | 'pending_confirmation'
  error_message text,
  created_at timestamptz default now()
);

create index if not exists idx_disk_maintenance_created_at on disk_maintenance_log(created_at);

-- ============================================================
-- 4. Pending confirmations — the required gate for anything touching
--    AI models, user uploads, or generated content. Never auto-fixed,
--    ever, regardless of auto_fix_enabled — an action here only moves
--    from 'pending' to 'confirmed' via an explicit admin click, which
--    is a separate authenticated request from the one that proposed it.
-- ============================================================
create table if not exists disk_pending_confirmations (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  target jsonb not null,              -- e.g. {"model": "llama3:70b"} or {"category": "uploads"}
  estimated_bytes bigint default 0,
  reason text,
  requested_by text not null default 'system',
  status text not null default 'pending', -- 'pending' | 'confirmed' | 'rejected' | 'expired'
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '7 days'),
  resolved_by uuid references profiles(id),
  resolved_at timestamptz
);

create index if not exists idx_disk_pending_status on disk_pending_confirmations(status);

-- ============================================================
-- 5. Database size — pg_database_size() needs a SQL-side function
--    since supabase-js only speaks PostgREST, not raw SQL. security
--    definer so a service-role call can read it without needing
--    superuser; it only ever returns a single number, no table access.
-- ============================================================
create or replace function rox_database_size_bytes()
returns bigint
language sql
security definer
as $$
  select pg_database_size(current_database());
$$;

-- =========================================================================
-- RLS: service-role only — same posture as advisor/optimizer tables.
-- Admins reach these ONLY through requireAdmin-gated backend routes.
-- =========================================================================
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'disk_monitor_settings','disk_usage_snapshots',
    'disk_maintenance_log','disk_pending_confirmations'
  ])
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'drop policy if exists service_role_only on %I; create policy service_role_only on %I for all using (auth.role() = ''service_role'');',
      t, t
    );
  end loop;
end $$;
