-- ZUVYR AI - webhook_events permission lockdown
--
-- Browser roles must never read or pre-claim Stripe event IDs.
-- Only the trusted backend service role may access this table.
-- Existing rows are preserved.

begin;

alter table public.webhook_events enable row level security;

revoke all privileges on table public.webhook_events
from public, anon, authenticated;

grant select, insert, update, delete
on table public.webhook_events
to service_role;

commit;