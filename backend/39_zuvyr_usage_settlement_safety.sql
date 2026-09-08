-- ZUVYR 39: usage settlement safety, before the first activation.
-- Apply after 28 in the SAME reviewed transaction for a fresh setup.
-- An existing nonempty new ledger requires a separate migration review.
-- Does not grant credits, configure plan limits, or enable provider execution.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.zuvyr_usage_records in access exclusive mode;
do $guard$
begin
  if exists (select 1 from public.zuvyr_usage_records limit 1) then
    raise exception 'usage_safety_install_requires_empty_new_ledger';
  end if;
end;
$guard$;
alter table public.zuvyr_usage_records
  add column if not exists subscription_period_started_at timestamptz,
  add column if not exists subscription_period_ends_at timestamptz,
  add column if not exists allow_topup_authorized boolean not null default false;

create or replace function public.reserve_zuvyr_usage(
  p_user_id uuid,
  p_request_id text,
  p_idempotency_key text,
  p_capability text,
  p_provider text,
  p_model_tool text,
  p_pricing_version text,
  p_reserved_credits integer,
  p_estimated_provider_cost_microusd numeric,
  p_allow_topup boolean,
  p_enforcement_enabled boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_profile public.profiles%rowtype;
  v_existing public.zuvyr_usage_records%rowtype;
  v_now timestamptz;
  v_week_index bigint;
  v_five_remaining integer;
  v_week_remaining integer;
  v_funding_source text;
begin
  if not coalesce(p_enforcement_enabled, false) then
    return jsonb_build_object(
      'success', false,
      'error', 'usage_enforcement_disabled'
    );
  end if;

  if p_user_id is null
    or nullif(trim(p_request_id), '') is null
    or nullif(trim(p_idempotency_key), '') is null
    or nullif(trim(p_capability), '') is null
    or nullif(trim(p_provider), '') is null
    or nullif(trim(p_model_tool), '') is null
    or nullif(trim(p_pricing_version), '') is null
    or p_reserved_credits is null
    or p_reserved_credits <= 0
    or p_estimated_provider_cost_microusd is null
    or p_estimated_provider_cost_microusd < 0
    or p_estimated_provider_cost_microusd::text in ('NaN', 'Infinity', '-Infinity')
    or p_estimated_provider_cost_microusd <> trunc(p_estimated_provider_cost_microusd)
    or p_estimated_provider_cost_microusd >= 1e20
    or length(p_request_id) > 200
    or length(p_idempotency_key) > 200
  then
    return jsonb_build_object(
      'success', false,
      'error', 'invalid_usage_reservation'
    );
  end if;

  select *
  into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'user_not_found'
    );
  end if;

  -- A profile lock is shared by every reserve and settlement. Read time and
  -- replay state AFTER acquiring it, including after a concurrent request waits.
  v_now := clock_timestamp();
  select *
  into v_existing
  from public.zuvyr_usage_records
  where idempotency_key = trim(p_idempotency_key)
     or request_id = trim(p_request_id)
  order by id
  limit 1
  for update;

  if found then
    if v_existing.user_id is distinct from p_user_id
      or v_existing.request_id is distinct from trim(p_request_id)
      or v_existing.idempotency_key is distinct from trim(p_idempotency_key)
      or v_existing.capability is distinct from trim(p_capability)
      or v_existing.provider is distinct from trim(p_provider)
      or v_existing.model_tool is distinct from trim(p_model_tool)
      or v_existing.pricing_version is distinct from trim(p_pricing_version)
      or v_existing.reserved_credits is distinct from p_reserved_credits
      or v_existing.estimated_provider_cost_microusd is distinct from p_estimated_provider_cost_microusd
      or v_existing.allow_topup_authorized is distinct from coalesce(p_allow_topup, false)
    then
      return jsonb_build_object(
        'success', false,
        'error', 'idempotency_conflict'
      );
    end if;

    return jsonb_build_object(
      'success', true,
      'replayed', true,
      'usage_record_id', v_existing.id,
      'funding_source', v_existing.funding_source,
      'reserved_credits', v_existing.reserved_credits,
      'state', v_existing.state
    );
  end if;


  if v_profile.subscription_status in ('plus', 'pro', 'legend', 'max')
    and v_profile.billing_status in ('active', 'trialing', 'past_due')
    and v_profile.usage_units_total is not null
    and v_profile.usage_week_units_total is not null
    and v_profile.subscription_current_period_start is not null
    and v_profile.subscription_current_period_end is not null
    and v_profile.subscription_current_period_start <= v_now
    and v_profile.subscription_current_period_end > v_now
  then
    if v_profile.usage_window_started_at is null
      or v_profile.usage_window_ends_at is null
      or v_profile.usage_window_started_at > v_now
      or v_profile.usage_window_started_at < v_profile.subscription_current_period_start
      or v_profile.usage_window_ends_at > v_profile.subscription_current_period_end
      or v_profile.usage_window_ends_at <= v_now
    then
      v_profile.usage_window_started_at := v_now;
      v_profile.usage_window_ends_at := least(v_now + interval '5 hours', v_profile.subscription_current_period_end);
      v_profile.usage_units_used := 0;
    end if;

    if v_now < v_profile.subscription_current_period_start then
      return jsonb_build_object(
        'success', false,
        'error', 'weekly_anchor_is_in_the_future'
      );
    end if;

    v_week_index := floor(
      extract(
        epoch from (
          v_now - v_profile.subscription_current_period_start
        )
      ) / 604800
    );

    if v_profile.usage_week_started_at is distinct from
        v_profile.subscription_current_period_start + (v_week_index * interval '7 days')
      or v_profile.usage_week_ends_at is distinct from least(
        v_profile.subscription_current_period_start + ((v_week_index + 1) * interval '7 days'),
        v_profile.subscription_current_period_end)
    then
      v_profile.usage_week_started_at :=
        v_profile.subscription_current_period_start +
        (v_week_index * interval '7 days');
      v_profile.usage_week_ends_at :=
        least(v_profile.usage_week_started_at + interval '7 days', v_profile.subscription_current_period_end);
      v_profile.usage_week_units_used := 0;
    end if;

    v_five_remaining := greatest(
      0,
      v_profile.usage_units_total - v_profile.usage_units_used
    );
    v_week_remaining := greatest(
      0,
      v_profile.usage_week_units_total -
        v_profile.usage_week_units_used
    );

    if v_five_remaining >= p_reserved_credits
      and v_week_remaining >= p_reserved_credits
    then
      v_funding_source := 'subscription';

      update public.profiles
      set
        usage_window_started_at = v_profile.usage_window_started_at,
        usage_window_ends_at = v_profile.usage_window_ends_at,
        usage_units_used =
          v_profile.usage_units_used + p_reserved_credits,
        usage_week_started_at = v_profile.usage_week_started_at,
        usage_week_ends_at = v_profile.usage_week_ends_at,
        usage_week_units_used =
          v_profile.usage_week_units_used + p_reserved_credits,
        billing_updated_at = now()
      where id = p_user_id;
    end if;
  end if;

  if v_funding_source is null
    and coalesce(p_allow_topup, false)
    and v_profile.topup_credits_balance >= p_reserved_credits
  then
    v_funding_source := 'topup';

    update public.profiles
    set
      topup_credits_balance =
        topup_credits_balance - p_reserved_credits,
      billing_updated_at = now()
    where id = p_user_id;
  end if;

  if v_funding_source is null then
    return jsonb_build_object(
      'success', false,
      'error', case
        when coalesce(p_allow_topup, false) and v_profile.topup_credits_balance < p_reserved_credits
          then 'insufficient_topup_credits'
        when v_profile.subscription_current_period_start is null
          or v_profile.subscription_current_period_end is null
          or v_profile.subscription_current_period_start > v_now
          or v_profile.subscription_current_period_end <= v_now
          or v_profile.subscription_status not in ('plus', 'pro', 'legend', 'max')
          or v_profile.subscription_status is null
          or v_profile.billing_status not in ('active', 'trialing', 'past_due')
          or v_profile.billing_status is null
          then 'subscription_inactive'
        when v_profile.subscription_status in (
          'plus', 'pro', 'legend', 'max'
        )
          and v_profile.billing_status in (
            'active', 'trialing', 'past_due'
          )
          and (
            v_profile.usage_units_total is null
            or v_profile.usage_week_units_total is null
          )
          then 'plan_limits_unconfigured'
        when coalesce(v_five_remaining, 0) < p_reserved_credits
          then 'five_hour_allowance_exhausted'
        when coalesce(v_week_remaining, 0) < p_reserved_credits
          then 'weekly_allowance_exhausted'
        else 'insufficient_topup_credits'
      end,
      'five_hour_remaining', v_five_remaining,
      'five_hour_reset_at', v_profile.usage_window_ends_at,
      'weekly_remaining', v_week_remaining,
      'weekly_reset_at', v_profile.usage_week_ends_at,
      'topup_credits_balance', v_profile.topup_credits_balance
    );
  end if;

  insert into public.zuvyr_usage_records (
    user_id,
    request_id,
    idempotency_key,
    capability,
    provider,
    model_tool,
    pricing_version,
    funding_source,
    reserved_credits,
    estimated_provider_cost_microusd,
    subscription_period_started_at,
    subscription_period_ends_at,
    allow_topup_authorized,
    five_hour_started_at,
    five_hour_ends_at,
    weekly_started_at,
    weekly_ends_at
  )
  values (
    p_user_id,
    trim(p_request_id),
    trim(p_idempotency_key),
    trim(p_capability),
    trim(p_provider),
    trim(p_model_tool),
    trim(p_pricing_version),
    v_funding_source,
    p_reserved_credits,
    p_estimated_provider_cost_microusd,
    v_profile.subscription_current_period_start,
    v_profile.subscription_current_period_end,
    coalesce(p_allow_topup, false),
    v_profile.usage_window_started_at,
    v_profile.usage_window_ends_at,
    v_profile.usage_week_started_at,
    v_profile.usage_week_ends_at
  )
  returning * into v_existing;

  return jsonb_build_object(
    'success', true,
    'replayed', false,
    'usage_record_id', v_existing.id,
    'funding_source', v_existing.funding_source,
    'reserved_credits', v_existing.reserved_credits,
    'five_hour_reset_at', v_existing.five_hour_ends_at,
    'weekly_reset_at', v_existing.weekly_ends_at,
    'topup_credits_balance', case
      when v_funding_source = 'topup'
        then v_profile.topup_credits_balance - p_reserved_credits
      else v_profile.topup_credits_balance
    end
  );
exception when unique_violation then
  -- The enclosing exception block rolls back every debit on a cross-user
  -- collision as well. Never return a conflict after leaving a debit behind.
  return jsonb_build_object('success', false, 'error', 'idempotency_conflict');
end;
$function$;

create or replace function public.settle_zuvyr_usage(
  p_request_id text,
  p_actual_credits integer,
  p_actual_provider_cost_microusd numeric,
  p_revenue_microusd numeric,
  p_gross_profit_microusd numeric,
  p_gross_margin_bps integer,
  p_provider_usage jsonb,
  p_enforcement_enabled boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_record public.zuvyr_usage_records%rowtype;
  v_profile public.profiles%rowtype;
  v_refund integer;
begin
  if not coalesce(p_enforcement_enabled, false) then
    return jsonb_build_object(
      'success', false,
      'error', 'usage_enforcement_disabled'
    );
  end if;

  if nullif(trim(p_request_id), '') is null
    or p_actual_credits is null
    or p_actual_credits < 0
    or p_actual_provider_cost_microusd is null
    or p_actual_provider_cost_microusd < 0
    or p_revenue_microusd is null
    or p_revenue_microusd < 0
    or p_gross_profit_microusd is null
    or p_gross_margin_bps is null
    or p_gross_margin_bps not between -1000000 and 10000
    or p_actual_provider_cost_microusd::text in ('NaN', 'Infinity', '-Infinity')
    or p_revenue_microusd::text in ('NaN', 'Infinity', '-Infinity')
    or p_gross_profit_microusd::text in ('NaN', 'Infinity', '-Infinity')
    or p_actual_provider_cost_microusd <> trunc(p_actual_provider_cost_microusd)
    or p_revenue_microusd <> trunc(p_revenue_microusd)
    or p_gross_profit_microusd <> trunc(p_gross_profit_microusd)
    or p_actual_provider_cost_microusd >= 1e20
    or p_revenue_microusd >= 1e20
    or abs(p_gross_profit_microusd) >= 1e20
    or jsonb_typeof(coalesce(p_provider_usage, '{}'::jsonb)) <> 'object'
  then
    return jsonb_build_object(
      'success', false,
      'error', 'invalid_usage_settlement'
    );
  end if;

  select *
  into v_record
  from public.zuvyr_usage_records
  where request_id = trim(p_request_id);

  if not found then
    return jsonb_build_object('success', false, 'error', 'usage_reservation_not_found');
  end if;

  -- Match reserve's profile -> usage record lock order. The initial lookup
  -- finds the owner only; the authoritative state is read again under lock.
  select * into v_profile from public.profiles
  where id = v_record.user_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'user_not_found');
  end if;
  select * into v_record from public.zuvyr_usage_records
  where request_id = trim(p_request_id) for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'usage_reservation_not_found'
    );
  end if;

  if v_record.state in ('settled', 'refunded') then
    if v_record.actual_credits is distinct from p_actual_credits
      or v_record.actual_provider_cost_microusd is distinct from p_actual_provider_cost_microusd
      or v_record.revenue_microusd is distinct from p_revenue_microusd
      or v_record.gross_profit_microusd is distinct from p_gross_profit_microusd
      or v_record.gross_margin_bps is distinct from p_gross_margin_bps
      or v_record.provider_usage is distinct from coalesce(p_provider_usage, '{}'::jsonb)
    then
      return jsonb_build_object('success', false, 'error', 'settlement_conflict');
    end if;
    return jsonb_build_object(
      'success', true,
      'replayed', true,
      'state', v_record.state,
      'actual_credits', v_record.actual_credits,
      'refunded_credits', v_record.refunded_credits
    );
  end if;

  if v_record.state <> 'reserved' then
    return jsonb_build_object('success', false, 'error', 'usage_record_not_settleable');
  end if;

  if p_actual_credits > v_record.reserved_credits then
    return jsonb_build_object(
      'success', false,
      'error', 'actual_usage_exceeds_reservation'
    );
  end if;

  v_refund := v_record.reserved_credits - p_actual_credits;

  if v_refund > 0 and v_record.funding_source = 'subscription' then
    update public.profiles
    set
      -- Each counter has its own identity. A late result from an old window
      -- or subscription period must never reduce consumption in a new one.
      usage_units_used = case when
        subscription_current_period_start = v_record.subscription_period_started_at
        and subscription_current_period_end = v_record.subscription_period_ends_at
        and usage_window_started_at = v_record.five_hour_started_at
        and usage_window_ends_at = v_record.five_hour_ends_at
        then greatest(0, usage_units_used - v_refund) else usage_units_used end,
      usage_week_units_used = case when
        subscription_current_period_start = v_record.subscription_period_started_at
        and subscription_current_period_end = v_record.subscription_period_ends_at
        and usage_week_started_at = v_record.weekly_started_at
        and usage_week_ends_at = v_record.weekly_ends_at
        then greatest(0, usage_week_units_used - v_refund) else usage_week_units_used end,
      billing_updated_at = now()
    where id = v_record.user_id;
  elsif v_refund > 0 and v_record.funding_source = 'topup' then
    if v_profile.topup_credits_balance::bigint + v_refund::bigint > 2147483647 then
      return jsonb_build_object('success', false, 'error', 'topup_refund_overflow');
    end if;
    update public.profiles
    set
      topup_credits_balance = topup_credits_balance + v_refund,
      billing_updated_at = now()
    where id = v_record.user_id;
  end if;

  update public.zuvyr_usage_records
  set
    actual_credits = p_actual_credits,
    refunded_credits = v_refund,
    actual_provider_cost_microusd =
      p_actual_provider_cost_microusd,
    revenue_microusd = p_revenue_microusd,
    gross_profit_microusd = p_gross_profit_microusd,
    gross_margin_bps = p_gross_margin_bps,
    provider_usage = coalesce(p_provider_usage, '{}'::jsonb),
    state = case
      when p_actual_credits = 0 then 'refunded'
      else 'settled'
    end,
    settled_at = now(),
    updated_at = now()
  where id = v_record.id;

  return jsonb_build_object(
    'success', true,
    'replayed', false,
    'state', case
      when p_actual_credits = 0 then 'refunded'
      else 'settled'
    end,
    'reserved_credits', v_record.reserved_credits,
    'actual_credits', p_actual_credits,
    'refunded_credits', v_refund
  );
end;
$function$;

create or replace function public.refund_zuvyr_usage(
  p_request_id text,
  p_actual_provider_cost_microusd numeric default 0,
  p_enforcement_enabled boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  return public.settle_zuvyr_usage(
    p_request_id,
    0,
    p_actual_provider_cost_microusd,
    0,
    -p_actual_provider_cost_microusd,
    0,
    jsonb_build_object('refund', true),
    p_enforcement_enabled
  );
end;
$function$;

revoke execute on function public.reserve_zuvyr_usage(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  numeric,
  boolean,
  boolean
)
from public, anon, authenticated;

grant execute on function public.reserve_zuvyr_usage(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  numeric,
  boolean,
  boolean
)
to service_role;

revoke execute on function public.settle_zuvyr_usage(
  text,
  integer,
  numeric,
  numeric,
  numeric,
  integer,
  jsonb,
  boolean
)
from public, anon, authenticated;

grant execute on function public.settle_zuvyr_usage(
  text,
  integer,
  numeric,
  numeric,
  numeric,
  integer,
  jsonb,
  boolean
)
to service_role;

revoke execute on function public.refund_zuvyr_usage(
  text,
  numeric,
  boolean
)
from public, anon, authenticated;

grant execute on function public.refund_zuvyr_usage(
  text,
  numeric,
  boolean
)
to service_role;


commit;
