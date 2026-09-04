-- ZUVYR V1 - atomic Stripe Checkout settlement
-- Run after 24_stripe_webhook_processing_state.sql.
--
-- A checkout settlement must be all-or-nothing:
--   1. Update the user's subscription or legacy top-up balance.
--   2. Record exactly one revenue event.
--   3. Mark the Stripe webhook event as processed.
--
-- Any failure rolls the complete transaction back so Stripe can retry.

begin;

create unique index if not exists
  revenue_events_stripe_event_unique
  on public.revenue_events (stripe_event_id)
  where stripe_event_id is not null;

create or replace function public.settle_stripe_checkout_event(
  p_event_id text,
  p_user_id uuid,
  p_checkout_type text,
  p_plan text,
  p_credits integer,
  p_amount_usd numeric,
  p_currency text,
  p_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_metadata jsonb,
  p_legacy_credits_total integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_processing_status text;
  v_profile_rows integer := 0;
  v_event_rows integer := 0;
  v_new_credits_total integer;
begin
  if nullif(trim(p_event_id), '') is null then
    raise exception 'event_id is required'
      using errcode = '22023';
  end if;

  if p_user_id is null then
    raise exception 'user_id is required'
      using errcode = '22023';
  end if;

  if p_checkout_type not in ('topup', 'subscription') then
    raise exception 'unsupported checkout type'
      using errcode = '22023';
  end if;

  if p_amount_usd is null or p_amount_usd < 0 then
    raise exception 'invalid checkout amount'
      using errcode = '22023';
  end if;

  select processing_status
  into v_processing_status
  from public.webhook_events
  where event_id = p_event_id
  for update;

  if not found then
    raise exception 'webhook event was not claimed';
  end if;

  if v_processing_status <> 'processing' then
    raise exception 'webhook event is not processing';
  end if;

  if p_checkout_type = 'topup' then
    if p_credits is null or p_credits <= 0 then
      raise exception 'invalid top-up credits'
        using errcode = '22023';
    end if;

    update public.profiles
    set credits_total = coalesce(credits_total, 0) + p_credits
    where id = p_user_id
    returning credits_total into v_new_credits_total;

    get diagnostics v_profile_rows = row_count;
  else
    if p_plan not in ('plus', 'pro', 'legend', 'max') then
      raise exception 'invalid subscription plan'
        using errcode = '22023';
    end if;

    if (
      p_legacy_credits_total is not null
      and p_legacy_credits_total < 0
    ) then
      raise exception 'invalid legacy credit allowance'
        using errcode = '22023';
    end if;

    update public.profiles
    set
      subscription_status = p_plan,
      billing_status = 'active',
      stripe_customer_id = coalesce(
        nullif(trim(p_customer_id), ''),
        stripe_customer_id
      ),
      stripe_subscription_id = coalesce(
        nullif(trim(p_subscription_id), ''),
        stripe_subscription_id
      ),
      stripe_price_id = coalesce(
        nullif(trim(p_price_id), ''),
        stripe_price_id
      ),
      credits_total = case
        when p_legacy_credits_total is null
          then credits_total
        else p_legacy_credits_total
      end,
      credits_used = case
        when p_legacy_credits_total is null
          then credits_used
        else 0
      end,
      last_reset_date = case
        when p_legacy_credits_total is null
          then last_reset_date
        else now()
      end,
      billing_updated_at = now()
    where id = p_user_id
    returning credits_total into v_new_credits_total;

    get diagnostics v_profile_rows = row_count;
  end if;

  if v_profile_rows <> 1 then
    raise exception 'billing profile was not found';
  end if;

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
    p_user_id,
    p_checkout_type,
    p_amount_usd,
    lower(coalesce(nullif(trim(p_currency), ''), 'usd')),
    p_event_id,
    case
      when p_checkout_type = 'topup'
        then p_credits
      else 0
    end,
    coalesce(p_metadata, '{}'::jsonb)
  );

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
    'event_id', p_event_id,
    'checkout_type', p_checkout_type,
    'plan', case
      when p_checkout_type = 'subscription'
        then p_plan
      else null
    end,
    'credits_added', case
      when p_checkout_type = 'topup'
        then p_credits
      else 0
    end,
    'credits_total', v_new_credits_total
  );
end;
$function$;

revoke execute on function
  public.settle_stripe_checkout_event(
    text,
    uuid,
    text,
    text,
    integer,
    numeric,
    text,
    text,
    text,
    text,
    jsonb,
    integer
  )
from public, anon, authenticated;

grant execute on function
  public.settle_stripe_checkout_event(
    text,
    uuid,
    text,
    text,
    integer,
    numeric,
    text,
    text,
    text,
    text,
    jsonb,
    integer
  )
to service_role;

commit;