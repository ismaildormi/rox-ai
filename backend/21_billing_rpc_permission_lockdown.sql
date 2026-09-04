-- ZUVYR billing RPC permission lockdown
-- Run after migrations 01-20.
--
-- Financial SECURITY DEFINER functions must only be callable through
-- the trusted backend service role. Browser roles must never be able
-- to add, deduct, refund, or settle credits directly.

begin;

revoke execute on function public.add_topup_credits(uuid, integer)
from public, anon, authenticated;

revoke execute on function public.deduct_credit_and_log(
  uuid, text, text, boolean, integer, text, text, text, jsonb
)
from public, anon, authenticated;

revoke execute on function public.refund_credit_and_log(text)
from public, anon, authenticated;

revoke execute on function public.settle_credit_charge(text, integer)
from public, anon, authenticated;

grant execute on function public.add_topup_credits(uuid, integer)
to service_role;

grant execute on function public.deduct_credit_and_log(
  uuid, text, text, boolean, integer, text, text, text, jsonb
)
to service_role;

grant execute on function public.refund_credit_and_log(text)
to service_role;

grant execute on function public.settle_credit_charge(text, integer)
to service_role;

commit;