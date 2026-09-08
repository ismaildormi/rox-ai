-- ZUVYR profile guard compatibility after migrations 28 and 39.
-- No columns, balances or customer rows are changed by this correction.
begin;
do $guard_prerequisite$
begin
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace
    and proname='protect_sensitive_profile_columns' and pronargs=0
    and md5(regexp_replace(prosrc,'\s+','','g'))='3f440aa2efacb4720cf9775a51fbc418') then
    raise exception 'profile_guard_must_match_migration_28';
  end if;
end;
$guard_prerequisite$;

create or replace function public.protect_sensitive_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    new.credits_total := old.credits_total;
    new.credits_used := old.credits_used;
    new.subscription_status := old.subscription_status;
    new.last_reset_date := old.last_reset_date;
    -- Preserve this optional legacy field without accessing a missing member.
    if to_jsonb(old) ? 'is_admin' then
      new := jsonb_populate_record(new,
        jsonb_build_object('is_admin', to_jsonb(old)->'is_admin'));
    end if;
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
    new.usage_window_started_at := old.usage_window_started_at;
    new.usage_window_ends_at := old.usage_window_ends_at;
    new.usage_units_total := old.usage_units_total;
    new.usage_units_used := old.usage_units_used;
    new.usage_week_started_at := old.usage_week_started_at;
    new.usage_week_ends_at := old.usage_week_ends_at;
    new.usage_week_units_total := old.usage_week_units_total;
    new.usage_week_units_used := old.usage_week_units_used;
    new.topup_credits_balance := old.topup_credits_balance;
    new.billing_updated_at := old.billing_updated_at;
    new.stripe_subscription_event_created_at :=
      old.stripe_subscription_event_created_at;
    new.stripe_subscription_event_id :=
      old.stripe_subscription_event_id;
  end if;

  return new;
end;
$function$;

revoke execute on function public.protect_sensitive_profile_columns()
from public, anon, authenticated;

grant execute on function public.protect_sensitive_profile_columns()
to service_role;


commit;
