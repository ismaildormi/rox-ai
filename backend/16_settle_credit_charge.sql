-- ROX AI ΓÇö settle a reserved Code Studio charge to its final cost.
-- Run after 15_chat_feedback.sql.

create or replace function settle_credit_charge(
  p_request_id text,
  p_final_credits integer
)
returns json as $$
declare
  v_log credit_audit_log%rowtype;
  v_current_credits integer;
  v_delta integer;
  v_available integer;
  v_new_balance integer;
begin
  if p_final_credits is null or p_final_credits < 0 then
    return json_build_object('success', false, 'error', 'invalid_final_credits');
  end if;

  select * into v_log
  from credit_audit_log
  where request_id = p_request_id
  order by id desc
  limit 1
  for update;

  if not found then
    return json_build_object('success', false, 'error', 'original_charge_not_found');
  end if;

  if v_log.status <> 'success' then
    return json_build_object('success', false, 'error', 'charge_not_settleable', 'status', v_log.status);
  end if;

  v_current_credits := coalesce(v_log.credits_consumed, 0);
  v_delta := p_final_credits - v_current_credits;

  select credits_total - credits_used into v_available
  from profiles
  where id = v_log.user_id
  for update;

  if v_available is null then
    return json_build_object('success', false, 'error', 'user_not_found');
  end if;

  if v_delta > 0 and v_available < v_delta then
    return json_build_object(
      'success', false,
      'error', 'insufficient_credits',
      'available', v_available,
      'required', v_delta
    );
  end if;

  update profiles
  set credits_used = greatest(0, credits_used + v_delta)
  where id = v_log.user_id
  returning credits_total - credits_used into v_new_balance;

  update credit_audit_log
  set credits_consumed = p_final_credits,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'settled', true,
        'reserved_credits', v_current_credits,
        'final_credits', p_final_credits,
        'settlement_delta', v_delta
      )
  where id = v_log.id;

  return json_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'reserved_credits', v_current_credits,
    'final_credits', p_final_credits,
    'delta', v_delta,
    'replayed', v_delta = 0
  );
end;
$$ language plpgsql security definer;
