-- ZUVYR V1 billing database foundation
-- Run after 21_billing_rpc_permission_lockdown.sql.
--
-- This migration is additive. It preserves the legacy credits_total,
-- credits_used and last_reset_date values while introducing:
--   1. Free / Plus / Pro / Legend / Max plan identity.
--   2. Stripe subscription synchronization fields.
--   3. A shared five-hour allowance window.
--   4. A separate persistent top-up wallet.
--
-- Runtime activation happens in a later backend change after this
-- contract is applied and verified in production.

begin;

alter table public.profiles
  add column if not exists billing_status text not null default 'inactive',
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id text,
  add column if not exists subscription_current_period_start timestamptz,
  add column if not exists subscription_current_period_end timestamptz,
  add column if not exists subscription_cancel_at_period_end boolean not null default false,
  add column if not exists usage_window_started_at timestamptz,
  add column if not exists usage_window_ends_at timestamptz,
  add column if not exists usage_units_total integer,
  add column if not exists usage_units_used integer not null default 0,
  add column if not exists topup_credits_balance integer not null default 0,
  add column if not exists billing_updated_at timestamptz not null default now();

alter table public.profiles
  drop constraint if exists profiles_zuvyr_plan_allowed;

alter table public.profiles
  add constraint profiles_zuvyr_plan_allowed
  check (
    subscription_status is null
    or subscription_status in (
      'free',
      'plus',
      'pro',
      'legend',
      'max'
    )
  );

alter table public.profiles
  drop constraint if exists profiles_zuvyr_billing_status_allowed;

alter table public.profiles
  add constraint profiles_zuvyr_billing_status_allowed
  check (
    billing_status in (
      'inactive',
      'trialing',
      'active',
      'past_due',
      'unpaid',
      'paused',
      'canceled',
      'incomplete',
      'incomplete_expired'
    )
  );

alter table public.profiles
  drop constraint if exists profiles_zuvyr_usage_units_nonnegative;

alter table public.profiles
  add constraint profiles_zuvyr_usage_units_nonnegative
  check (
    (usage_units_total is null or usage_units_total >= 0)
    and usage_units_used >= 0
  );

alter table public.profiles
  drop constraint if exists profiles_zuvyr_topup_balance_nonnegative;

alter table public.profiles
  add constraint profiles_zuvyr_topup_balance_nonnegative
  check (topup_credits_balance >= 0);

alter table public.profiles
  drop constraint if exists profiles_zuvyr_usage_window_order;

alter table public.profiles
  add constraint profiles_zuvyr_usage_window_order
  check (
    usage_window_started_at is null
    or usage_window_ends_at is null
    or usage_window_ends_at > usage_window_started_at
  );

create unique index if not exists
  profiles_zuvyr_stripe_customer_unique
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists
  profiles_zuvyr_stripe_subscription_unique
  on public.profiles (stripe_subscription_id)
  where stripe_subscription_id is not null;

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
  end if;

  return new;
end;
$function$;

drop trigger if exists
  trg_protect_sensitive_profile_columns
  on public.profiles;

create trigger trg_protect_sensitive_profile_columns
  before update on public.profiles
  for each row
  execute procedure public.protect_sensitive_profile_columns();

revoke execute on function
  public.protect_sensitive_profile_columns()
from public, anon, authenticated;

grant execute on function
  public.protect_sensitive_profile_columns()
to service_role;

commit;