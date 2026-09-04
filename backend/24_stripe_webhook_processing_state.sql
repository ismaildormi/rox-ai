-- ZUVYR V1 - durable Stripe webhook processing state
-- Run after 23_webhook_events_security.sql.
--
-- Compatibility:
-- Existing rows and inserts from the currently deployed legacy webhook
-- default to processed. The guarded runtime migration will explicitly
-- claim new events as processing before performing billing work.

begin;

alter table public.webhook_events
  add column if not exists processing_status text not null default 'processed',
  add column if not exists attempt_count integer not null default 1,
  add column if not exists processing_started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();

update public.webhook_events
set completed_at = coalesce(completed_at, updated_at)
where processing_status = 'processed'
  and completed_at is null;

alter table public.webhook_events
  drop constraint if exists webhook_events_processing_status_allowed;

alter table public.webhook_events
  add constraint webhook_events_processing_status_allowed
  check (
    processing_status in (
      'processing',
      'processed',
      'failed'
    )
  );

alter table public.webhook_events
  drop constraint if exists webhook_events_attempt_count_positive;

alter table public.webhook_events
  add constraint webhook_events_attempt_count_positive
  check (attempt_count >= 1);

create or replace function public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_inserted integer := 0;
  v_status text;
  v_updated_at timestamptz;
  v_attempt integer;
begin
  if nullif(trim(p_event_id), '') is null then
    raise exception 'event_id is required'
      using errcode = '22023';
  end if;

  if nullif(trim(p_event_type), '') is null then
    raise exception 'event_type is required'
      using errcode = '22023';
  end if;

  insert into public.webhook_events (
    event_id,
    event_type,
    processing_status,
    attempt_count,
    processing_started_at,
    completed_at,
    last_error,
    updated_at
  )
  values (
    p_event_id,
    p_event_type,
    'processing',
    1,
    now(),
    null,
    null,
    now()
  )
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    return jsonb_build_object(
      'success', true,
      'action', 'process',
      'attempt', 1
    );
  end if;

  select
    processing_status,
    updated_at,
    attempt_count
  into
    v_status,
    v_updated_at,
    v_attempt
  from public.webhook_events
  where event_id = p_event_id
  for update;

  if not found then
    raise exception 'webhook event disappeared during claim';
  end if;

  if v_status = 'processed' then
    return jsonb_build_object(
      'success', true,
      'action', 'duplicate',
      'attempt', v_attempt
    );
  end if;

  if (
    v_status = 'processing'
    and v_updated_at > now() - interval '10 minutes'
  ) then
    return jsonb_build_object(
      'success', true,
      'action', 'in_progress',
      'attempt', v_attempt
    );
  end if;

  update public.webhook_events
  set
    event_type = p_event_type,
    processing_status = 'processing',
    attempt_count = attempt_count + 1,
    processing_started_at = now(),
    completed_at = null,
    last_error = null,
    updated_at = now()
  where event_id = p_event_id
  returning attempt_count into v_attempt;

  return jsonb_build_object(
    'success', true,
    'action', 'process',
    'attempt', v_attempt
  );
end;
$function$;

create or replace function public.complete_stripe_webhook_event(
  p_event_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_updated integer := 0;
begin
  update public.webhook_events
  set
    processing_status = 'processed',
    completed_at = now(),
    last_error = null,
    updated_at = now()
  where event_id = p_event_id
    and processing_status = 'processing';

  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'success', v_updated = 1,
    'updated', v_updated
  );
end;
$function$;

create or replace function public.fail_stripe_webhook_event(
  p_event_id text,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_updated integer := 0;
begin
  update public.webhook_events
  set
    processing_status = 'failed',
    completed_at = null,
    last_error = left(coalesce(p_error, 'unknown_error'), 1000),
    updated_at = now()
  where event_id = p_event_id
    and processing_status = 'processing';

  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'success', v_updated = 1,
    'updated', v_updated
  );
end;
$function$;

revoke execute on function
  public.claim_stripe_webhook_event(text, text)
from public, anon, authenticated;

revoke execute on function
  public.complete_stripe_webhook_event(text)
from public, anon, authenticated;

revoke execute on function
  public.fail_stripe_webhook_event(text, text)
from public, anon, authenticated;

grant execute on function
  public.claim_stripe_webhook_event(text, text)
to service_role;

grant execute on function
  public.complete_stripe_webhook_event(text)
to service_role;

grant execute on function
  public.fail_stripe_webhook_event(text, text)
to service_role;

commit;