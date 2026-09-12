-- ZUVYR Pack 009 — Supabase security corrections
-- Additive/idempotent correction migration. Never replays historical migrations.
-- Managed storage default privileges are intentionally NOT changed here.

begin;

-- ---------------------------------------------------------------------------
-- 1. Restore required admin capability while preserving the existing profile
--    guard. Migration 40 already protects is_admin when the column exists.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Restore intended server-only posture for operational tables.
--    service_role has BYPASSRLS; no client policy is required.
-- ---------------------------------------------------------------------------
alter table public.revenue_events enable row level security;
alter table public.shared_conversations enable row level security;

drop policy if exists service_role_only on public.revenue_events;
drop policy if exists service_role_only on public.shared_conversations;

revoke all privileges on table public.revenue_events
from public, anon, authenticated;

revoke all privileges on table public.shared_conversations
from public, anon, authenticated;

grant select, insert, update, delete on table public.revenue_events
to service_role;

grant select, insert, update, delete on table public.shared_conversations
to service_role;

-- ---------------------------------------------------------------------------
-- 3. Financial audit view must execute with caller permissions and remain
--    inaccessible to browser roles.
-- ---------------------------------------------------------------------------
alter view public.credit_audit_mismatches
  set (security_invoker = true);

revoke all privileges on table public.credit_audit_mismatches
from public, anon, authenticated;

grant select on table public.credit_audit_mismatches
to service_role;

-- ---------------------------------------------------------------------------
-- PACK009_DEDUCT_LINT_FIX_BEGIN
-- Recreate the canonical deduct RPC without the unused v_existing row variable.
create or replace function public.deduct_credit_and_log(
  p_user_id uuid,
  p_feature text,
  p_model_used text,
  p_fallback_triggered boolean,
  p_credits_consumed integer,
  p_status text,
  p_request_id text default null,
  p_error_message text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns json as $$
declare
  v_available integer;
  v_new_balance integer;
begin
  -- Idempotency: if this exact requestId already produced a 'success'
  -- charge, replay that outcome instead of touching the balance again.
  -- (Only meaningful for p_status = 'success' — error/blocked log rows
  -- are informational and don't move the balance, so replaying them
  -- isn't a correctness issue, but we still short-circuit for safety.)
  if p_request_id is not null then
    perform 1 from credit_audit_log where request_id = p_request_id and status = 'success';
    if found then
      select credits_total - credits_used into v_new_balance
      from profiles where id = p_user_id;
      return json_build_object('success', true, 'new_balance', v_new_balance, 'replayed', true);
    end if;
  end if;

  if p_status = 'success' and p_credits_consumed > 0 then
    -- Row lock: any concurrent call for this same user now serializes here,
    -- which is exactly what was missing before.
    select credits_total - credits_used into v_available
    from profiles where id = p_user_id
    for update;

    if v_available is null then
      return json_build_object('success', false, 'error', 'user_not_found');
    end if;

    if v_available < p_credits_consumed then
      return json_build_object(
        'success', false,
        'error', 'insufficient_credits',
        'available', v_available,
        'required', p_credits_consumed
      );
    end if;

    update profiles
    set credits_used = credits_used + p_credits_consumed
    where id = p_user_id
    returning credits_total - credits_used into v_new_balance;
  end if;

  -- The partial unique index above is the backstop: if two racing
  -- transactions somehow both got past the check above (they can't,
  -- because of the row lock, but this is defense in depth), only one
  -- INSERT here would succeed and the other would raise a unique
  -- violation instead of silently double-billing.
  insert into credit_audit_log (
    user_id, request_id, feature, model_used, fallback_triggered,
    credits_consumed, status, error_message, metadata
  ) values (
    p_user_id, p_request_id, p_feature, p_model_used, p_fallback_triggered,
    p_credits_consumed, p_status, p_error_message, p_metadata
  );

  return json_build_object('success', true, 'new_balance', v_new_balance, 'replayed', false);
end;
$$ language plpgsql security definer;
-- PACK009_DEDUCT_LINT_FIX_END

-- 4. Fix mutable search_path on privileged/internal functions.
-- ---------------------------------------------------------------------------
alter function public.handle_new_user()
  set search_path = pg_catalog, public, pg_temp;

alter function public.circuit_check(text, integer)
  set search_path = pg_catalog, public, pg_temp;

alter function public.circuit_report(text, boolean, integer)
  set search_path = pg_catalog, public, pg_temp;

alter function public.rox_database_size_bytes()
  set search_path = pg_catalog, public, pg_temp;

alter function public.add_topup_credits(uuid, integer)
  set search_path = pg_catalog, public, pg_temp;

alter function public.deduct_credit_and_log(
  uuid, text, text, boolean, integer, text, text, text, jsonb
)
  set search_path = pg_catalog, public, pg_temp;

alter function public.refund_credit_and_log(text)
  set search_path = pg_catalog, public, pg_temp;

alter function public.settle_credit_charge(text, integer)
  set search_path = pg_catalog, public, pg_temp;

alter function public.rox_touch_conversation_updated_at()
  set search_path = pg_catalog, public, pg_temp;

alter function public.rox_append_conversation_message(
  uuid, uuid, text, text, text, jsonb, jsonb, text, text, text
)
  set search_path = pg_catalog, public, pg_temp;

-- ---------------------------------------------------------------------------
-- 5. Internal RPC/trigger functions must not be callable by browser roles.
-- ---------------------------------------------------------------------------
revoke execute on function public.handle_new_user()
from public, anon, authenticated;
grant execute on function public.handle_new_user()
to service_role, supabase_auth_admin;

revoke execute on function public.circuit_check(text, integer)
from public, anon, authenticated;
grant execute on function public.circuit_check(text, integer)
to service_role;

revoke execute on function public.circuit_report(text, boolean, integer)
from public, anon, authenticated;
grant execute on function public.circuit_report(text, boolean, integer)
to service_role;

revoke execute on function public.rox_database_size_bytes()
from public, anon, authenticated;
grant execute on function public.rox_database_size_bytes()
to service_role;

revoke execute on function public.rox_append_conversation_message(
  uuid, uuid, text, text, text, jsonb, jsonb, text, text, text
)
from public, anon, authenticated;
grant execute on function public.rox_append_conversation_message(
  uuid, uuid, text, text, text, jsonb, jsonb, text, text, text
)
to service_role;

revoke execute on function public.rox_touch_conversation_updated_at()
from public, anon, authenticated;
grant execute on function public.rox_touch_conversation_updated_at()
to service_role;

-- Reinforce the existing financial RPC contract.
revoke execute on function public.add_topup_credits(uuid, integer)
from public, anon, authenticated;
revoke execute on function public.deduct_credit_and_log(
  uuid, text, text, boolean, integer, text, text, text, jsonb
)
from public, anon, authenticated;
revoke execute on function public.refund_credit_and_log(text)
from public, anon, authenticated;
revoke execute on function public.settle_credit_charge(text, integer)
from public, anon, authenticated;

grant execute on function public.add_topup_credits(uuid, integer)
to service_role;
grant execute on function public.deduct_credit_and_log(
  uuid, text, text, boolean, integer, text, text, text, jsonb
)
to service_role;
grant execute on function public.refund_credit_and_log(text)
to service_role;
grant execute on function public.settle_credit_charge(text, integer)
to service_role;

-- ---------------------------------------------------------------------------
-- 6. Prevent recurrence for NEW objects created by postgres in public.
--    Keep service_role defaults intact. Do not touch managed storage defaults.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

commit;
