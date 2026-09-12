-- ZUVYR Pack 012 — Financial RPC Invariants
-- Additive compatibility hardening only.
-- No balances are granted, charged, refunded or otherwise mutated by install.
-- Existing financial rows are preserved; only legacy settlement metadata is reconciled.

do $pack012$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.credit_audit_log') is null
  then
    raise exception 'pack012_financial_prerequisites_missing';
  end if;

  if exists (
    select 1
    from public.credit_audit_log
    where credits_consumed < 0
  ) then
    raise exception 'pack012_negative_legacy_credit_audit_detected';
  end if;
end
$pack012$;

alter table public.credit_audit_log
  add column if not exists reserved_credits integer;

alter table public.credit_audit_log
  add column if not exists settled_final_credits integer;

-- Preserve the original reservation where an older settlement already recorded it.
update public.credit_audit_log
set reserved_credits =
  case
    when coalesce(metadata->>'settled', 'false') = 'true'
      and coalesce(metadata->>'reserved_credits', '') ~ '^[0-9]{1,10}$'
      and (metadata->>'reserved_credits')::numeric <= 2147483647
      then (metadata->>'reserved_credits')::integer
    else credits_consumed
  end
where status in ('success', 'refunded')
  and reserved_credits is null;

-- Older settle_credit_charge versions already replaced credits_consumed with final cost.
update public.credit_audit_log
set settled_final_credits = credits_consumed
where status in ('success', 'refunded')
  and coalesce(metadata->>'settled', 'false') = 'true'
  and settled_final_credits is null;

do $pack012$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'credit_audit_reserved_credits_nonnegative'
      and conrelid = 'public.credit_audit_log'::regclass
  ) then
    alter table public.credit_audit_log
      add constraint credit_audit_reserved_credits_nonnegative
      check (reserved_credits is null or reserved_credits >= 0)
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'credit_audit_settled_final_nonnegative'
      and conrelid = 'public.credit_audit_log'::regclass
  ) then
    alter table public.credit_audit_log
      add constraint credit_audit_settled_final_nonnegative
      check (settled_final_credits is null or settled_final_credits >= 0)
      not valid;
  end if;
end
$pack012$;

alter table public.credit_audit_log
  validate constraint credit_audit_reserved_credits_nonnegative;

alter table public.credit_audit_log
  validate constraint credit_audit_settled_final_nonnegative;


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
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_existing public.credit_audit_log%rowtype;
  v_available bigint;
  v_new_balance bigint;
begin
  if p_credits_consumed is null or p_credits_consumed < 0 then
    return json_build_object(
      'success', false,
      'error', 'invalid_credits_consumed'
    );
  end if;

  if p_status = 'success'
     and p_credits_consumed > 0
     and (
       p_request_id is null
       or nullif(trim(p_request_id), '') is null
       or length(trim(p_request_id)) > 200
     )
  then
    return json_build_object(
      'success', false,
      'error', 'request_id_required_for_charge'
    );
  end if;

  if p_status = 'success' and p_credits_consumed > 0 then
    -- Serialize the logical financial operation globally by request id.
    perform pg_advisory_xact_lock(
      hashtextextended(trim(p_request_id), 0)
    );

    select *
    into v_existing
    from public.credit_audit_log
    where request_id = trim(p_request_id)
      and status in ('success', 'refunded')
    order by id desc
    limit 1
    for update;

    if found then
      if v_existing.status = 'refunded' then
        return json_build_object(
          'success', false,
          'error', 'request_already_refunded'
        );
      end if;

      if v_existing.user_id is distinct from p_user_id
         or coalesce(
              v_existing.reserved_credits,
              v_existing.credits_consumed
            ) is distinct from p_credits_consumed
      then
        return json_build_object(
          'success', false,
          'error', 'idempotency_conflict'
        );
      end if;

      select
        credits_total::bigint - credits_used::bigint
      into v_new_balance
      from public.profiles
      where id = p_user_id;

      return json_build_object(
        'success', true,
        'new_balance', v_new_balance,
        'replayed', true
      );
    end if;

    select
      credits_total::bigint - credits_used::bigint
    into v_available
    from public.profiles
    where id = p_user_id
    for update;

    if v_available is null then
      return json_build_object(
        'success', false,
        'error', 'user_not_found'
      );
    end if;

    -- Re-check after the profile lock in case a same-user concurrent call waited.
    select *
    into v_existing
    from public.credit_audit_log
    where request_id = trim(p_request_id)
      and status in ('success', 'refunded')
    order by id desc
    limit 1
    for update;

    if found then
      if v_existing.status = 'refunded' then
        return json_build_object(
          'success', false,
          'error', 'request_already_refunded'
        );
      end if;

      if v_existing.user_id is distinct from p_user_id
         or coalesce(
              v_existing.reserved_credits,
              v_existing.credits_consumed
            ) is distinct from p_credits_consumed
      then
        return json_build_object(
          'success', false,
          'error', 'idempotency_conflict'
        );
      end if;

      return json_build_object(
        'success', true,
        'new_balance', v_available,
        'replayed', true
      );
    end if;

    if v_available < p_credits_consumed then
      return json_build_object(
        'success', false,
        'error', 'insufficient_credits',
        'available', v_available,
        'required', p_credits_consumed
      );
    end if;

    update public.profiles
    set credits_used = credits_used + p_credits_consumed
    where id = p_user_id
    returning
      credits_total::bigint - credits_used::bigint
    into v_new_balance;
  end if;

  insert into public.credit_audit_log (
    user_id,
    request_id,
    feature,
    model_used,
    fallback_triggered,
    credits_consumed,
    reserved_credits,
    status,
    error_message,
    metadata
  )
  values (
    p_user_id,
    case
      when p_request_id is null then null
      else nullif(trim(p_request_id), '')
    end,
    p_feature,
    p_model_used,
    p_fallback_triggered,
    p_credits_consumed,
    case
      when p_status = 'success' and p_credits_consumed > 0
        then p_credits_consumed
      else null
    end,
    p_status,
    p_error_message,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return json_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'replayed', false
  );

exception
  when unique_violation then
    -- PL/pgSQL rolls back every statement in this block before entering here.
    return json_build_object(
      'success', false,
      'error', 'idempotency_conflict'
    );
end
$fn$;


create or replace function public.refund_credit_and_log(
  p_request_id text
)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_log public.credit_audit_log%rowtype;
  v_profile public.profiles%rowtype;
  v_new_balance bigint;
begin
  if p_request_id is null
     or nullif(trim(p_request_id), '') is null
     or length(trim(p_request_id)) > 200
  then
    return json_build_object(
      'success', false,
      'error', 'invalid_request_id'
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(trim(p_request_id), 0)
  );

  select *
  into v_log
  from public.credit_audit_log
  where request_id = trim(p_request_id)
    and status in ('success', 'refunded')
  order by id desc
  limit 1
  for update;

  if not found then
    return json_build_object(
      'success', false,
      'error', 'original_charge_not_found'
    );
  end if;

  if v_log.status = 'refunded' then
    select
      credits_total::bigint - credits_used::bigint
    into v_new_balance
    from public.profiles
    where id = v_log.user_id;

    return json_build_object(
      'success', true,
      'new_balance', v_new_balance,
      'already_refunded', true
    );
  end if;

  if v_log.credits_consumed is null
     or v_log.credits_consumed < 0
  then
    return json_build_object(
      'success', false,
      'error', 'invalid_original_charge'
    );
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_log.user_id
  for update;

  if not found then
    return json_build_object(
      'success', false,
      'error', 'user_not_found'
    );
  end if;

  if v_profile.credits_used < v_log.credits_consumed then
    return json_build_object(
      'success', false,
      'error', 'refund_balance_conflict'
    );
  end if;

  update public.profiles
  set credits_used = credits_used - v_log.credits_consumed
  where id = v_log.user_id
  returning
    credits_total::bigint - credits_used::bigint
  into v_new_balance;

  update public.credit_audit_log
  set
    status = 'refunded',
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
           'legacy_refunded', true
         )
  where id = v_log.id;

  return json_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'already_refunded', false
  );
end
$fn$;


create or replace function public.settle_credit_charge(
  p_request_id text,
  p_final_credits integer
)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_log public.credit_audit_log%rowtype;
  v_current_credits bigint;
  v_difference bigint;
  v_available bigint;
  v_current_used bigint;
  v_new_used bigint;
  v_new_balance bigint;
begin
  if p_request_id is null
     or nullif(trim(p_request_id), '') is null
     or length(trim(p_request_id)) > 200
  then
    return json_build_object(
      'success', false,
      'error', 'invalid_request_id'
    );
  end if;

  if p_final_credits is null or p_final_credits < 0 then
    return json_build_object(
      'success', false,
      'error', 'invalid_final_credits'
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(trim(p_request_id), 0)
  );

  select *
  into v_log
  from public.credit_audit_log
  where request_id = trim(p_request_id)
    and status in ('success', 'refunded')
  order by id desc
  limit 1
  for update;

  if not found then
    return json_build_object(
      'success', false,
      'error', 'original_charge_not_found'
    );
  end if;

  if v_log.status = 'refunded' then
    return json_build_object(
      'success', false,
      'error', 'charge_already_refunded'
    );
  end if;

  if v_log.settled_final_credits is not null then
    if v_log.settled_final_credits = p_final_credits then
      select
        credits_total::bigint - credits_used::bigint
      into v_new_balance
      from public.profiles
      where id = v_log.user_id;

      return json_build_object(
        'success', true,
        'already_settled', true,
        'replayed', true,
        'new_balance', v_new_balance,
        'final_credits', v_log.settled_final_credits
      );
    end if;

    return json_build_object(
      'success', false,
      'error', 'settlement_conflict',
      'settled_final_credits', v_log.settled_final_credits,
      'requested_final_credits', p_final_credits
    );
  end if;

  v_current_credits := coalesce(
    v_log.reserved_credits,
    v_log.credits_consumed,
    0
  );

  v_difference := p_final_credits::bigint - v_current_credits;

  select
    credits_total::bigint - credits_used::bigint,
    credits_used::bigint
  into
    v_available,
    v_current_used
  from public.profiles
  where id = v_log.user_id
  for update;

  if v_available is null then
    return json_build_object(
      'success', false,
      'error', 'user_not_found'
    );
  end if;

  if v_difference > 0 and v_available < v_difference then
    return json_build_object(
      'success', false,
      'error', 'insufficient_credits',
      'available', v_available,
      'required', v_difference
    );
  end if;

  v_new_used := v_current_used + v_difference;

  if v_new_used < 0 or v_new_used > 2147483647 then
    return json_build_object(
      'success', false,
      'error', 'settlement_balance_conflict'
    );
  end if;

  update public.profiles
  set credits_used = v_new_used::integer
  where id = v_log.user_id
  returning
    credits_total::bigint - credits_used::bigint
  into v_new_balance;

  update public.credit_audit_log
  set
    reserved_credits = coalesce(
      reserved_credits,
      v_current_credits::integer
    ),
    credits_consumed = p_final_credits,
    settled_final_credits = p_final_credits,
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
           'settled', true,
           'reserved_credits', v_current_credits,
           'final_credits', p_final_credits
         )
  where id = v_log.id;

  return json_build_object(
    'success', true,
    'already_settled', false,
    'replayed', false,
    'reserved_credits', v_current_credits,
    'final_credits', p_final_credits,
    'difference', v_difference,
    'new_balance', v_new_balance
  );
end
$fn$;


revoke execute on function public.deduct_credit_and_log(
  uuid, text, text, boolean, integer, text, text, text, jsonb
) from public, anon, authenticated;

revoke execute on function public.refund_credit_and_log(text)
from public, anon, authenticated;

revoke execute on function public.settle_credit_charge(text, integer)
from public, anon, authenticated;

grant execute on function public.deduct_credit_and_log(
  uuid, text, text, boolean, integer, text, text, text, jsonb
) to service_role;

grant execute on function public.refund_credit_and_log(text)
to service_role;

grant execute on function public.settle_credit_charge(text, integer)
to service_role;
