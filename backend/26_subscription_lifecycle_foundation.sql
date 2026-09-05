-- ZUVYR V1 - subscription lifecycle database foundation
-- Run after 25_atomic_stripe_checkout_settlement.sql.
--
-- This migration is additive. Existing profile balances, plans,
-- Stripe identifiers and webhook rows remain unchanged.
-- Runtime event routing is activated in a later guarded change.

begin;

alter table public.profiles
  add column if not exists
    stripe_subscription_event_created_at timestamptz,
  add column if not exists
    stripe_subscription_event_id text;

create or replace function public.protect_sensitive_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.role() <> 'service_role' then
    new.credits_total := old.credits_total;
    new.credits_used := old.credits_used;
    new.subscription_status := old.subscription_status;
    new.last_reset_date := old.last_reset_date;
    new.is_admin := old.is_admin;

    new.billing_status := old.billing_status;
    new.stripe_customer_id := old.stripe_customer_id;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.stripe_price_id := old.stripe_price_id;
    new.subscription_current_period_start :=
      old.subscription_current_period_start;
    new.subscription_current_period_end :=
      old.subscription_current_period_end;
    new.subscription_cancel_at_period_end :=
      old.subscription_cancel_at_period_end;
    new.usage_window_started_at :=
      old.usage_window_started_at;
    new.usage_window_ends_at :=
      old.usage_window_ends_at;
    new.usage_units_total := old.usage_units_total;
    new.usage_units_used := old.usage_units_used;
    new.topup_credits_balance :=
      old.topup_credits_balance;
    new.billing_updated_at := old.billing_updated_at;
    new.stripe_subscription_event_created_at :=
      old.stripe_subscription_event_created_at;
    new.stripe_subscription_event_id :=
      old.stripe_subscription_event_id;
  end if;

  return new;
end;
$function$;

revoke execute on function
  public.protect_sensitive_profile_columns()
from public, anon, authenticated;

grant execute on function
  public.protect_sensitive_profile_columns()
to service_role;

create or replace function
  public.settle_stripe_subscription_lifecycle_event(
    p_event_id text,
    p_event_created_at timestamptz,
    p_user_id uuid,
    p_subscription_id text,
    p_customer_id text,
    p_price_id text,
    p_plan text,
    p_billing_status text,
    p_period_start timestamptz,
    p_period_end timestamptz,
    p_cancel_at_period_end boolean
  )
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_webhook_status text;
  v_profile_id uuid;
  v_existing_subscription_id text;
  v_existing_customer_id text;
  v_existing_billing_status text;
  v_existing_event_created_at timestamptz;
  v_access_plan text;
  v_event_rows integer := 0;
  v_stale boolean := false;
begin
  if nullif(trim(p_event_id), '') is null then
    raise exception 'event_id is required'
      using errcode = '22023';
  end if;

  if p_event_created_at is null then
    raise exception 'event_created_at is required'
      using errcode = '22023';
  end if;

  if nullif(trim(p_subscription_id), '') is null then
    raise exception 'subscription_id is required'
      using errcode = '22023';
  end if;

  if nullif(trim(p_customer_id), '') is null then
    raise exception 'customer_id is required'
      using errcode = '22023';
  end if;

  if nullif(trim(p_price_id), '') is null then
    raise exception 'price_id is required'
      using errcode = '22023';
  end if;

  if p_plan not in ('plus', 'pro', 'legend', 'max') then
    raise exception 'invalid subscription plan'
      using errcode = '22023';
  end if;

  if p_billing_status not in (
    'inactive',
    'trialing',
    'active',
    'past_due',
    'unpaid',
    'paused',
    'canceled',
    'incomplete',
    'incomplete_expired'
  ) then
    raise exception 'invalid billing status'
      using errcode = '22023';
  end if;

  if (
    p_period_start is not null
    and p_period_end is not null
    and p_period_end <= p_period_start
  ) then
    raise exception 'invalid subscription period'
      using errcode = '22023';
  end if;

  select processing_status
  into v_webhook_status
  from public.webhook_events
  where event_id = p_event_id
  for update;

  if not found then
    raise exception 'webhook event was not claimed';
  end if;

  if v_webhook_status <> 'processing' then
    raise exception 'webhook event is not processing';
  end if;

  if p_user_id is not null then
    select
      id,
      stripe_subscription_id,
      stripe_customer_id,
      billing_status,
      stripe_subscription_event_created_at
    into
      v_profile_id,
      v_existing_subscription_id,
      v_existing_customer_id,
      v_existing_billing_status,
      v_existing_event_created_at
    from public.profiles
    where id = p_user_id
    for update;
  else
    select
      id,
      stripe_subscription_id,
      stripe_customer_id,
      billing_status,
      stripe_subscription_event_created_at
    into
      v_profile_id,
      v_existing_subscription_id,
      v_existing_customer_id,
      v_existing_billing_status,
      v_existing_event_created_at
    from public.profiles
    where stripe_subscription_id = trim(p_subscription_id)
    for update;

    if v_profile_id is null then
      select
        id,
        stripe_subscription_id,
        stripe_customer_id,
        billing_status,
        stripe_subscription_event_created_at
      into
        v_profile_id,
        v_existing_subscription_id,
        v_existing_customer_id,
        v_existing_billing_status,
        v_existing_event_created_at
      from public.profiles
      where stripe_customer_id = trim(p_customer_id)
      for update;
    end if;
  end if;

  if v_profile_id is null then
    raise exception 'billing profile was not found';
  end if;

  if (
    v_existing_customer_id is not null
    and v_existing_customer_id <> trim(p_customer_id)
  ) then
    raise exception 'Stripe customer does not match profile';
  end if;

  if (
    v_existing_subscription_id is not null
    and v_existing_subscription_id <> trim(p_subscription_id)
    and v_existing_billing_status not in (
      'inactive',
      'canceled',
      'unpaid',
      'incomplete_expired'
    )
  ) then
    raise exception 'profile already has another active subscription';
  end if;

  v_stale :=
    v_existing_event_created_at is not null
    and (
      p_event_created_at < v_existing_event_created_at
      or (
        p_event_created_at = v_existing_event_created_at
        and v_existing_subscription_id = trim(p_subscription_id)
        and v_existing_billing_status in (
          'canceled',
          'unpaid',
          'incomplete_expired'
        )
        and p_billing_status not in (
          'canceled',
          'unpaid',
          'incomplete_expired'
        )
      )
    );

  if v_stale then
    update public.webhook_events
    set
      processing_status = 'processed',
      completed_at = now(),
      last_error = null,
      updated_at = now()
    where event_id = p_event_id
      and processing_status = 'processing';

    get diagnostics v_event_rows = row_count;

    if v_event_rows <> 1 then
      raise exception 'webhook event completion failed';
    end if;

    return jsonb_build_object(
      'success', true,
      'applied', false,
      'stale', true,
      'profile_id', v_profile_id
    );
  end if;

  v_access_plan := case
    when p_billing_status in (
      'active',
      'trialing',
      'past_due'
    ) then p_plan
    else 'free'
  end;

  update public.profiles
  set
    subscription_status = v_access_plan,
    billing_status = p_billing_status,
    stripe_customer_id = trim(p_customer_id),
    stripe_subscription_id = trim(p_subscription_id),
    stripe_price_id = trim(p_price_id),
    subscription_current_period_start = p_period_start,
    subscription_current_period_end = p_period_end,
    subscription_cancel_at_period_end =
      coalesce(p_cancel_at_period_end, false),
    usage_window_started_at = case
      when v_access_plan = 'free'
        then null
      else usage_window_started_at
    end,
    usage_window_ends_at = case
      when v_access_plan = 'free'
        then null
      else usage_window_ends_at
    end,
    usage_units_total = case
      when v_access_plan = 'free'
        then null
      else usage_units_total
    end,
    usage_units_used = case
      when v_access_plan = 'free'
        then 0
      else usage_units_used
    end,
    stripe_subscription_event_created_at =
      p_event_created_at,
    stripe_subscription_event_id = p_event_id,
    billing_updated_at = now()
  where id = v_profile_id;

  update public.webhook_events
  set
    processing_status = 'processed',
    completed_at = now(),
    last_error = null,
    updated_at = now()
  where event_id = p_event_id
    and processing_status = 'processing';

  get diagnostics v_event_rows = row_count;

  if v_event_rows <> 1 then
    raise exception 'webhook event completion failed';
  end if;

  return jsonb_build_object(
    'success', true,
    'applied', true,
    'stale', false,
    'profile_id', v_profile_id,
    'plan', v_access_plan,
    'billing_status', p_billing_status
  );
end;
$function$;

revoke execute on function
  public.settle_stripe_subscription_lifecycle_event(
    text,
    timestamptz,
    uuid,
    text,
    text,
    text,
    text,
    text,
    timestamptz,
    timestamptz,
    boolean
  )
from public, anon, authenticated;

grant execute on function
  public.settle_stripe_subscription_lifecycle_event(
    text,
    timestamptz,
    uuid,
    text,
    text,
    text,
    text,
    text,
    timestamptz,
    timestamptz,
    boolean
  )
to service_role;

commit;