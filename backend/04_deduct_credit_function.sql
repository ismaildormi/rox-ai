-- ROX AI — Atomic credit deduction
-- Wraps the "increment credits_used" + "insert audit row" pair in a single
-- transaction via a Postgres function, called through supabaseAdmin.rpc().
-- Two separate JS calls (update, then insert) can't tear this way; a
-- crash between them would leave the ledger and the fast counter out of
-- sync. SECURITY DEFINER means it runs with the privileges of the
-- function owner regardless of who calls it, but it's only ever invoked
-- with the service-role key from server code — never exposed to clients.

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
returns void as $$
begin
  if p_status = 'success' then
    update profiles
    set credits_used = credits_used + p_credits_consumed
    where id = p_user_id;
  end if;

  insert into credit_audit_log (
    user_id, request_id, feature, model_used, fallback_triggered,
    credits_consumed, status, error_message, metadata
  ) values (
    p_user_id, p_request_id, p_feature, p_model_used, p_fallback_triggered,
    p_credits_consumed, p_status, p_error_message, p_metadata
  );
end;
$$ language plpgsql security definer;
