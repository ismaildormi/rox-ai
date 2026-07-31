-- ROX AI — 11_topup_credits.sql
--
-- Adds purchased credits on top of a user's existing balance (does NOT
-- reset credits_used, unlike the monthly Pro/Free reset in
-- 08_maintenance.sql). Row-locked the same way 04/06's deduct function
-- is, so a webhook retry (Stripe resends events) can't double-add
-- credits for the same purchase.
--
-- Idempotency: the caller (stripeWebhook.js) already dedupes on
-- Stripe's event id before this ever runs (see the existing
-- `webhook_events` dedupe insert at the top of stripeWebhook.js), so
-- this function itself does not need its own idempotency key — it
-- trusts that it is only ever called once per completed top-up
-- checkout session.

create or replace function add_topup_credits(p_user_id uuid, p_credits integer)
returns jsonb as $$
declare
  v_new_total integer;
begin
  if p_credits <= 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_amount');
  end if;

  update profiles
  set credits_total = credits_total + p_credits
  where id = p_user_id
  returning credits_total into v_new_total;

  if not found then
    return jsonb_build_object('success', false, 'error', 'user_not_found');
  end if;

  return jsonb_build_object('success', true, 'new_total', v_new_total);
end;
$$ language plpgsql security definer;
