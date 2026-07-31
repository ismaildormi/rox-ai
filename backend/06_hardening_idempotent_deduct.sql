-- ROX AI — 06_hardening_idempotent_deduct.sql
-- Fixes two real gaps in 04_deduct_credit_function.sql:
--
--   1. No row lock: deduct_credit_and_log() updated `profiles` with a
--      plain UPDATE and no `FOR UPDATE`. Combined with the fact that
--      gatekeeper.js only checked the balance *before* calling the AI
--      model and deducted *after* (server.js, worker.js), two concurrent
--      requests from the same user could both pass the check and both
--      deduct, letting the balance go negative under real concurrency.
--
--   2. No idempotency: if a client retried a request (timeout, mobile
--      network drop) with the same requestId, or if BullMQ retried a
--      job that had actually already been billed, the user could be
--      charged twice for one logical action.
--
-- Run this AFTER 01-05. It replaces deduct_credit_and_log() with a
-- hardened version and adds refund_credit_and_log() as its counterpart.

-- A request_id can only ever back ONE successful charge. Refunding
-- flips that same row's status to 'refunded' in place (see below)
-- rather than inserting a second row, so this partial unique index
-- is all the idempotency guarantee needed at the DB level.
create unique index if not exists idx_credit_audit_log_request_id_success
  on credit_audit_log (request_id)
  where status = 'success' and request_id is not null;

create or replace function deduct_credit_and_log(
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
  v_existing credit_audit_log%rowtype;
  v_available integer;
  v_new_balance integer;
begin
  -- Idempotency: if this exact requestId already produced a 'success'
  -- charge, replay that outcome instead of touching the balance again.
  -- (Only meaningful for p_status = 'success' — error/blocked log rows
  -- are informational and don't move the balance, so replaying them
  -- isn't a correctness issue, but we still short-circuit for safety.)
  if p_request_id is not null then
    select * into v_existing from credit_audit_log where request_id = p_request_id and status = 'success';
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

-- ============================================================
-- Refund: reverses the ONE 'success' charge tied to a requestId.
-- Idempotent — calling it twice for the same requestId just
-- reports already_refunded=true the second time, no double credit.
-- ============================================================
create or replace function refund_credit_and_log(
  p_request_id text
)
returns json as $$
declare
  v_log credit_audit_log%rowtype;
  v_new_balance integer;
begin
  select * into v_log from credit_audit_log where request_id = p_request_id
  order by id desc limit 1
  for update;

  if not found then
    return json_build_object('success', false, 'error', 'original_charge_not_found');
  end if;

  if v_log.status = 'refunded' then
    select credits_total - credits_used into v_new_balance from profiles where id = v_log.user_id;
    return json_build_object('success', true, 'new_balance', v_new_balance, 'already_refunded', true);
  end if;

  if v_log.status != 'success' then
    return json_build_object('success', false, 'error', 'not_refundable', 'status', v_log.status);
  end if;

  update profiles
  set credits_used = credits_used - v_log.credits_consumed
  where id = v_log.user_id
  returning credits_total - credits_used into v_new_balance;

  update credit_audit_log set status = 'refunded' where id = v_log.id;

  return json_build_object('success', true, 'new_balance', v_new_balance, 'already_refunded', false);
end;
$$ language plpgsql security definer;
