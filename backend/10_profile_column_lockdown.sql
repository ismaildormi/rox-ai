-- ROX AI — 10_profile_column_lockdown.sql
--
-- Real gap in 02_rls_policies.sql, flagged in its own comments but never
-- actually closed: `update_own_profile` only checks ROW ownership
-- (auth.uid() = id) — Postgres RLS policies can't restrict which
-- COLUMNS a client is allowed to touch. In practice this meant any
-- authenticated user could call, from the browser, with nothing more
-- than the anon key + their own session:
--
--   supabase.from('profiles').update({
--     credits_total: 999999,
--     subscription_status: 'pro'
--   }).eq('id', session.user.id)
--
-- ...and RLS would allow it, because they *do* own that row. Nothing in
-- the current frontend code does this today, but the policy itself
-- doesn't prevent it, so it only takes one future update() call
-- (a new feature, a refactor, a copy-pasted snippet) to open it for
-- real. This closes it at the database level, independent of frontend
-- code ever getting it right.
--
-- Fix: a BEFORE UPDATE trigger that silently reverts credits_total,
-- credits_used, subscription_status, and last_reset_date to their
-- existing values whenever the write isn't coming from the service
-- role (auth.role() = 'service_role' — that's what gatekeeper.js,
-- stripeWebhook.js, and 08_maintenance.sql's functions all use).
-- A normal user can still update full_name (or any other non-sensitive
-- column you add later) — anything not explicitly locked here still
-- goes through untouched.
--
-- Run this after 09_margin_tracking.sql.

create or replace function protect_sensitive_profile_columns()
returns trigger as $$
begin
  if auth.role() <> 'service_role' then
    new.credits_total := old.credits_total;
    new.credits_used := old.credits_used;
    new.subscription_status := old.subscription_status;
    new.last_reset_date := old.last_reset_date;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_protect_sensitive_profile_columns on profiles;
create trigger trg_protect_sensitive_profile_columns
  before update on profiles
  for each row execute procedure protect_sensitive_profile_columns();

-- Sanity check you can run manually after applying this: as a logged-in
-- user (anon key + their JWT, NOT the service role key), try
--   update profiles set credits_total = 999999 where id = auth.uid();
-- It will report "1 row updated" (RLS still allows the row-level write),
-- but selecting the row back will show credits_total UNCHANGED — the
-- trigger silently kept the old value. Only server code using
-- SUPABASE_SERVICE_ROLE_KEY can actually move that number now.
