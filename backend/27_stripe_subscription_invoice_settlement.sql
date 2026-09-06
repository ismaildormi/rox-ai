-- ZUVYR V1 - atomic Stripe subscription invoice settlement
-- Run after 26_subscription_lifecycle_foundation.sql.
--
-- This function settles subscription renewals, paid plan changes and
-- payment failures in one transaction. Initial subscription invoices
-- remain owned by checkout.session.completed to avoid duplicate revenue.

begin;

create or replace function
  public.settle_stripe_subscription_invoice_event(
    p_event_id text,
    p_event_created_at timestamptz,
    p_invoice_id text,
    p_invoice_outcome text,
    p_billing_reason text,
    p_user_id uuid,
    p_subscription_id text,
    p_customer_id text,
    p_price_id text,
    p_plan text,
    p_subscription_status text,
    p_period_start timestamptz,
    p_period_end timestamptz,
    p_cancel_at_period_end boolean,
    p_amount_usd numeric,
    p_currency text,
    p_metadata jsonb
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
  v_revenue_recorded boolean := false;
begin
  if nullif(trim(p_event_id), '') is null then
    raise exception 'event_id is required'
      using errcode = '22023';
  end if;

  if p_event_created_at is null then
    raise exception 'event_created_at is required'
      using errcode = '22023';
  end if;

  if nullif(trim(p_invoice_id), '') is null then
    raise exception 'invoice_id is required'
      using errcode = '22023';
  end if;

  if p_invoice_outcome not in ('paid', 'payment_failed') then
    raise exception 'invalid invoice outcome'
      using errcode = '22023';
  end if;

  if p_invoice_outcome = 'paid' then
    if p_billing_reason not in (
      'subscription_cycle',
      'subscription_update'
    ) then
      raise exception 'unsupported paid invoice reason'
        using errcode = '22023';
    end if;

    if p_subscription_status <> 'active' then
      raise exception 'paid invoice subscription is not active'
        using errcode = '22023';
    end if;
  elsif p_billing_reason not in (
    'subscription_create',
    'subscription_cycle',
    'subscription_update'
  ) then
    raise exception 'unsupported failed invoice reason'
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

  if p_subscription_status not in (
    'trialing',
    'active',
    'past_due',
    'unpaid',
    'paused',
    'canceled',
    'incomplete',
    'incomplete_expired'
  ) then
    raise exception 'invalid subscription status'
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

  if p_amount_usd is null or p_amount_usd < 0 then
    raise exception 'invalid invoice amount'
      using errcode = '22023';
  end if;

  if lower(coalesce(trim(p_currency), '')) !~ '^[a-z]{3}$' then
    raise exception 'invalid invoice currency'
      using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'invoice metadata must be an object'
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
        and p_subscription_status not in (
          'canceled',
          'unpaid',
          'incomplete_expired'
        )
      )
    );

  if (
    p_invoice_outcome = 'payment_failed'
    and p_subscription_status in ('active', 'trialing')
  ) then
    v_stale := true;
  end if;

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
      'revenue_recorded', false,
      'profile_id', v_profile_id
    );
  end if;

  v_access_plan := case
    when p_subscription_status in (
      'active',
      'trialing',
      'past_due'
    ) then p_plan
    else 'free'
  end;

  update public.profiles
  set
    subscription_status = v_access_plan,
    billing_status = p_subscription_status,
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

  if p_invoice_outcome = 'paid' then
    insert into public.revenue_events (
      user_id,
      event_type,
      amount_usd,
      currency,
      stripe_event_id,
      credits,
      metadata
    )
    values (
      v_profile_id,
      'subscription',
      p_amount_usd,
      lower(trim(p_currency)),
      p_event_id,
      0,
      coalesce(p_metadata, '{}'::jsonb) ||
        jsonb_build_object(
          'invoice_id', trim(p_invoice_id),
          'billing_reason', p_billing_reason,
          'subscription_id', trim(p_subscription_id),
          'invoice_outcome', p_invoice_outcome
        )
    );

    v_revenue_recorded := true;
  end if;

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
    'revenue_recorded', v_revenue_recorded,
    'profile_id', v_profile_id,
    'plan', v_access_plan,
    'billing_status', p_subscription_status,
    'invoice_outcome', p_invoice_outcome
  );
end;
$function$;

revoke execute on function
  public.settle_stripe_subscription_invoice_event(
    text,
    timestamptz,
    text,
    text,
    text,
    uuid,
    text,
    text,
    text,
    text,
    text,
    timestamptz,
    timestamptz,
    boolean,
    numeric,
    text,
    jsonb
  )
from public, anon, authenticated;

grant execute on function
  public.settle_stripe_subscription_invoice_event(
    text,
    timestamptz,
    text,
    text,
    text,
    uuid,
    text,
    text,
    text,
    text,
    text,
    timestamptz,
    timestamptz,
    boolean,
    numeric,
    text,
    jsonb
  )
to service_role;

commit;
