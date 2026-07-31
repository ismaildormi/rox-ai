-- ROX AI — Maintenance & Alerting (v3.1 pass)
-- Three things the v3 README listed as "reste une décision humaine" and
-- that were still just TODOs: Stripe webhook idempotency, refund-failure
-- visibility, and mismatch/reset automation. This file turns each one
-- into a real table + function so a cron (pg_cron or an external
-- scheduler hitting /internal/maintenance/run) has something to call.
-- Run this after 07_model_health.sql.

-- ============================================================
-- 1. Stripe webhook idempotency
-- ============================================================
-- Stripe explicitly documents that the same event can be delivered more
-- than once (retries on timeout, manual resends from the dashboard).
-- stripeWebhook.js only ever *sets* subscription_status/credits_total to
-- a fixed value, so a duplicate delivery today is harmless in effect —
-- but it's silent, and a future webhook handler that does something
-- additive (e.g. "add credits", "send an email") would double-fire.
-- Record every processed event id up front and skip repeats.

create table if not exists webhook_events (
  event_id text primary key,       -- Stripe's event.id, globally unique
  event_type text not null,
  processed_at timestamp with time zone default timezone('utc'::text, now())
);

alter table webhook_events enable row level security;
create policy "no_client_access_webhook_events" on webhook_events
  for select using (false);

-- ============================================================
-- 2. Refund-failure dead letter + generic alert sink
-- ============================================================
-- Today a failed refund only reaches a console.error line — if nobody is
-- tailing logs at that moment, a user who paid credits for a generation
-- that never happened just stays out that balance. This table makes it
-- a queryable, re-driveable record instead of a line that scrolls away.

create table if not exists refund_failures (
  id bigint generated always as identity primary key,
  request_id text not null,
  user_id uuid references profiles(id) on delete cascade,
  feature text,
  error_message text,
  resolved boolean default false,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

create index if not exists idx_refund_failures_unresolved
  on refund_failures(resolved) where resolved = false;

alter table refund_failures enable row level security;
create policy "no_client_access_refund_failures" on refund_failures
  for select using (false);

-- Generic alert sink so this file and 03_audit_log.sql's mismatch view
-- both have one place to write to. Wiring this table to Slack/PagerDuty/
-- email is still the human step (e.g. a Supabase Edge Function on
-- insert, or the cron job itself posting a webhook after calling these
-- functions) — this just guarantees nothing is lost in the meantime.

create table if not exists system_alerts (
  id bigint generated always as identity primary key,
  alert_type text not null,        -- 'refund_failed' | 'credit_mismatch'
  severity text not null default 'warning', -- 'warning' | 'critical'
  message text not null,
  metadata jsonb default '{}'::jsonb,
  acknowledged boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table system_alerts enable row level security;
create policy "no_client_access_system_alerts" on system_alerts
  for select using (false);

create or replace function log_refund_failure(
  p_request_id text,
  p_user_id uuid,
  p_feature text,
  p_error_message text
) returns void as $$
begin
  insert into refund_failures (request_id, user_id, feature, error_message)
  values (p_request_id, p_user_id, p_feature, p_error_message);

  insert into system_alerts (alert_type, severity, message, metadata)
  values (
    'refund_failed',
    'critical',
    format('Refund failed for request %s (user %s): %s', p_request_id, p_user_id, p_error_message),
    jsonb_build_object('request_id', p_request_id, 'user_id', p_user_id, 'feature', p_feature)
  );
end;
$$ language plpgsql security definer;

-- ============================================================
-- 3. Credit audit mismatch → alert (turns the existing view into action)
-- ============================================================
-- credit_audit_mismatches (03_audit_log.sql) already computes drift; this
-- just writes each drifted user into system_alerts, and avoids re-alerting
-- on the same user every time the cron runs by checking for an
-- unacknowledged alert already open for them.

create or replace function check_credit_audit_mismatches()
returns integer as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in select * from credit_audit_mismatches loop
    if not exists (
      select 1 from system_alerts
      where alert_type = 'credit_mismatch'
        and acknowledged = false
        and metadata->>'user_id' = r.user_id::text
    ) then
      insert into system_alerts (alert_type, severity, message, metadata)
      values (
        'credit_mismatch',
        'critical',
        format('Credit drift for user %s: profile=%s ledger=%s drift=%s',
               r.user_id, r.profile_credits_used, r.ledger_credits_used, r.drift),
        jsonb_build_object('user_id', r.user_id, 'drift', r.drift)
      );
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count; -- number of new alerts raised, for logging by the caller
end;
$$ language plpgsql security definer;

-- ============================================================
-- 4. Monthly credit reset — both tiers
-- ============================================================
-- README listed this as "toujours pas automatisé". Pro used to be a
-- fixed 999999 allowance set once by stripeWebhook.js and never reset
-- (true-unlimited, no real cost ceiling). Pro is now a real 500-
-- credit/month pool (~50% guaranteed margin on the $10 plan — see
-- gatekeeper.js), so it needs the same monthly reset free already got.
-- Top-up credits (11_topup_credits.sql) are NOT touched here — a
-- top-up is a separate purchase on top of the monthly pool and should
-- persist even if unused when the monthly reset runs; only the base
-- monthly allowance resets. Window is 30 days from last_reset_date
-- rather than calendar-month, so it doesn't depend on when in the
-- month the cron happens to run.

create or replace function reset_monthly_credits(
  p_default_credits_free integer default 800,
  p_default_credits_pro integer default 500
)
returns integer as $$
declare
  v_count integer;
begin
  -- Adds the fresh monthly allowance on top of whatever's left unused
  -- (base pool AND any paid top-up credits — 11_topup_credits.sql) —
  -- does NOT overwrite credits_total to a fixed number. Overwriting
  -- would silently destroy top-up credits a user already paid for if
  -- the reset happens to land before they spend them.
  with reset as (
    update profiles
    set credits_total = (credits_total - credits_used) + case
          when subscription_status = 'pro' then p_default_credits_pro
          else p_default_credits_free
        end,
        credits_used = 0,
        last_reset_date = timezone('utc'::text, now())
    where subscription_status in ('free', 'pro')
      and last_reset_date < timezone('utc'::text, now()) - interval '30 days'
    returning 1
  )
  select count(*) into v_count from reset;
  return v_count; -- number of accounts reset, for logging by the caller
end;
$$ language plpgsql security definer;

-- ============================================================
-- 5. Scheduling
-- ============================================================
-- Option A — pg_cron (if the extension is enabled on your Supabase
-- project: Database → Extensions → pg_cron). Uncomment and run once:
--
-- select cron.schedule('rox-check-mismatches', '*/30 * * * *',
--   $$select check_credit_audit_mismatches();$$);
-- select cron.schedule('rox-reset-monthly-credits', '0 3 * * *',
--   $$select reset_monthly_credits();$$);
--
-- Option B — pg_cron isn't available on every Supabase plan. server.js
-- now exposes POST /internal/maintenance/run (guarded by CRON_SECRET)
-- which calls both functions — point any external scheduler at it
-- (Railway/Render cron job, GitHub Actions on a schedule, cron-job.org).
-- Use one option, not both, to avoid double-firing.
