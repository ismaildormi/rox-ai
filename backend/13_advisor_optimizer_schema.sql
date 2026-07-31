-- ROX AI — 13_advisor_optimizer_schema.sql
-- Schema for the AI Business Advisor and AI Auto Optimizer. Run after
-- 01–12, in that numeric order. Same conventions as 12_extension_schema.sql:
-- metadata jsonb escape hatch, created_at everywhere, RLS locked to
-- service-role only (this is admin-only surface — no end user ever
-- reads these tables directly, only through requireAdmin-gated routes).

-- ============================================================
-- 1. Admin role
-- ============================================================
-- Nothing in the schema so far distinguishes an admin from a regular
-- user. This is additive and nullable-safe: existing rows default to
-- false, no behavior changes for any existing user.
alter table profiles
  add column if not exists is_admin boolean not null default false;

-- SECURITY FIX: this column is created AFTER 10_profile_column_lockdown.sql's
-- protect_sensitive_profile_columns() trigger was written, so that trigger
-- never covered it. Left as-is, `update_own_profile` in 02_rls_policies.sql
-- only checks ROW ownership (auth.uid() = id) — it can't and doesn't
-- restrict which COLUMNS a client may write. That means, exactly like the
-- credits_total/subscription_status gap 10_profile_column_lockdown.sql
-- closed, any authenticated user could call, from the browser, with
-- nothing more than the anon key + their own session:
--
--   supabase.from('profiles').update({ is_admin: true }).eq('id', session.user.id)
--
-- ...and RLS would allow it, silently granting themselves access to every
-- route behind lib/requireAdmin.js (Business Advisor, Auto Optimizer,
-- Disk Monitor maintenance/deletion actions). Re-declaring (CREATE OR
-- REPLACE) the same trigger function here extends its protection to
-- is_admin too — idempotent, and safe to run whether or not
-- 10_profile_column_lockdown.sql already ran, since it only adds one
-- more column to the same revert-unless-service-role logic.
create or replace function protect_sensitive_profile_columns()
returns trigger as $$
begin
  if auth.role() <> 'service_role' then
    new.credits_total := old.credits_total;
    new.credits_used := old.credits_used;
    new.subscription_status := old.subscription_status;
    new.last_reset_date := old.last_reset_date;
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- Trigger already exists (created in 10_profile_column_lockdown.sql) and
-- points at this same function by name — no need to redeclare it, the
-- CREATE OR REPLACE FUNCTION above is enough. Re-created here anyway in
-- case this file is ever applied to a fresh database where 10 was skipped.
drop trigger if exists trg_protect_sensitive_profile_columns on profiles;
create trigger trg_protect_sensitive_profile_columns
  before update on profiles
  for each row execute procedure protect_sensitive_profile_columns();

-- ============================================================
-- 2. Revenue capture
-- ============================================================
-- The advisor can't analyze "Revenue" or "MRR" without a revenue
-- ledger — today a Stripe event only ever flips subscription_status or
-- adds top-up credits, nothing records the dollar amount anywhere
-- locally. This table is written by ONE new, additive, fire-and-forget
-- insert in stripeWebhook.js (never throws, never blocks the existing
-- subscription/credit logic — same non-blocking pattern as
-- src/modules/analytics/events.js's track()).
create table if not exists revenue_events (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete set null,
  event_type text not null,             -- 'subscription' | 'topup' | 'refund'
  amount_usd numeric not null,
  currency text default 'usd',
  stripe_event_id text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_revenue_events_created_at on revenue_events(created_at);

-- ============================================================
-- 3. Advisor: daily reports, recommendations, recommendation outcomes
-- ============================================================
create table if not exists advisor_daily_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  metrics jsonb not null default '{}'::jsonb,       -- raw collected metrics, see src/modules/advisor
  insights jsonb not null default '[]'::jsonb,       -- ["Revenue increased by 12%...", ...]
  health_scores jsonb not null default '{}'::jsonb,  -- {business: 82, financial: 74, ...}
  risks jsonb not null default '[]'::jsonb,
  forecast jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists advisor_recommendations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references advisor_daily_reports(id) on delete cascade,
  category text not null,               -- 'pricing' | 'provider' | 'model' | 'limits' | 'retention' | 'abuse' | 'infra' | 'opportunity'
  recommendation text not null,
  rationale text,
  confidence numeric default 0.5,       -- 0..1, adjusted over time by the feedback loop below
  status text not null default 'open',  -- 'open' | 'applied' | 'dismissed' | 'expired'
  optimizer_actionable boolean default false, -- true = the Auto Optimizer is allowed to act on this within safety rules
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id)
);

create index if not exists idx_advisor_recommendations_status on advisor_recommendations(status);

-- Feedback loop: when a recommendation is applied or dismissed, and
-- later there's enough data to say whether it helped, this is where
-- that judgment is recorded. src/modules/advisor reads this history to
-- raise/lower confidence for similar future recommendations (same
-- category + similar metric direction) — a simple, auditable
-- "learns over time" mechanism rather than an opaque model retrain.
create table if not exists advisor_recommendation_outcomes (
  id bigint generated always as identity primary key,
  recommendation_id uuid references advisor_recommendations(id) on delete cascade,
  outcome text not null,                -- 'improved' | 'neutral' | 'worsened'
  metric_delta jsonb default '{}'::jsonb,
  evaluated_at timestamptz default now()
);

-- ============================================================
-- 4. Optimizer: mode, safety rules, action log
-- ============================================================
-- Singleton-style settings row (id fixed to a constant) rather than a
-- per-admin table — the mode and safety rules are platform-wide, and a
-- single audited row is simpler to reason about than "whose settings
-- win." updated_by/updated_at give the audit trail.
create table if not exists optimizer_settings (
  id boolean primary key default true check (id),  -- enforces exactly one row
  mode text not null default 'manual',   -- 'manual' | 'automatic'
  safety_rules jsonb not null default '{}'::jsonb,
  updated_by uuid references profiles(id),
  updated_at timestamptz default now()
);

insert into optimizer_settings (id, mode) values (true, 'manual')
  on conflict (id) do nothing;

create table if not exists optimizer_actions_log (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,            -- 'provider_switch' | 'margin_adjustment' | 'cache_tune' | 'limit_adjustment' | ...
  description text not null,
  triggered_by text not null,           -- 'auto' | 'admin:<user_id>'
  before_state jsonb not null,
  after_state jsonb not null,
  safety_rules_snapshot jsonb not null default '{}'::jsonb, -- the rules in effect at the time, for audit
  reversed boolean not null default false,
  reversed_at timestamptz,
  reversed_by uuid references profiles(id),
  created_at timestamptz default now()
);

create index if not exists idx_optimizer_actions_created_at on optimizer_actions_log(created_at);

-- ============================================================
-- 5. Runtime overrides — the mechanism the Optimizer actually uses to
--    "act". Mirrors feature_flag_overrides' precedence pattern exactly
--    (DB override -> env var -> config file default) so it's the SAME
--    pattern already documented in ARCHITECTURE.md §3, not a new one.
--    The Optimizer never edits a JSON config file at runtime (that
--    would need a redeploy to roll back and isn't auditable per-row);
--    it writes/removes rows here instead, which src/core/config.js and
--    aiRouter.js read with the same override precedence.
-- ============================================================
create table if not exists runtime_overrides (
  override_key text primary key,        -- e.g. 'featureCost.image', 'provider_weight.chat'
  value jsonb not null,
  set_by text not null,                 -- 'auto' | 'admin:<user_id>'
  reason text,
  created_at timestamptz default now()
);

-- =========================================================================
-- RLS: service-role only, same posture as every other operational table.
-- Admins reach these ONLY through requireAdmin-gated backend routes —
-- never directly from a client-side Supabase call.
-- =========================================================================
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'revenue_events','advisor_daily_reports','advisor_recommendations',
    'advisor_recommendation_outcomes','optimizer_settings',
    'optimizer_actions_log','runtime_overrides'
  ])
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'drop policy if exists service_role_only on %I; create policy service_role_only on %I for all using (auth.role() = ''service_role'');',
      t, t
    );
  end loop;
end $$;

-- ============================================================
-- 6. Daily business snapshot — one view joining what already exists,
--    so src/modules/advisor/collect.js is mostly SELECTs, not new
--    aggregation logic duplicated in JS.
-- ============================================================
create or replace view rox_daily_business_snapshot as
select
  d::date as day,
  coalesce((select sum(amount_usd) from revenue_events r where r.event_type in ('subscription','topup') and r.created_at::date = d::date), 0) as revenue_usd,
  coalesce((select sum((metadata->>'cost_usd')::numeric) from credit_audit_log c where c.status = 'success' and c.metadata ? 'cost_usd' and c.created_at::date = d::date), 0) as ai_cost_usd,
  coalesce((select count(*) from profiles p where p.subscription_status = 'pro' and p.last_reset_date::date <= d::date), 0) as pro_users_approx,
  coalesce((select count(*) from credit_audit_log c where c.feature = 'chat' and c.created_at::date = d::date), 0) as chat_requests,
  coalesce((select count(*) from generation_jobs g where g.feature = 'image' and g.created_at::date = d::date), 0) as image_jobs,
  coalesce((select count(*) from generation_jobs g where g.feature = 'video' and g.created_at::date = d::date), 0) as video_jobs
from generate_series(current_date - interval '90 days', current_date, interval '1 day') as d;
