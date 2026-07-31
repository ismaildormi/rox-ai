-- ROX AI — Credit Audit Log
-- Tracks every credit-consuming event in detail: who, which model,
-- how much, and whether it succeeded. This is the source of truth
-- if a user disputes their balance, and the only way to catch
-- tampering (a mismatch between profiles.credits_used and the sum
-- of this table's credits_consumed is a red flag worth alerting on).

create table if not exists credit_audit_log (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  request_id text,                          -- correlates to a single API call, useful for support tickets
  feature text not null,                    -- 'chat' | 'image' | 'video' | 'code'
  model_used text not null,                 -- e.g. 'claude-sonnet-5', 'qwen3-coder-480b' — set by aiRouter, never by the client
  fallback_triggered boolean default false, -- true if the primary model failed and we routed to a backup
  credits_consumed integer not null default 1,
  status text not null,                     -- 'success' | 'error' | 'blocked'
  error_message text,
  metadata jsonb default '{}'::jsonb,       -- token counts, latency_ms, etc. — flexible, doesn't need a migration to extend
  created_at timestamp with time zone default timezone('utc'::text, now())
);

create index if not exists idx_credit_audit_log_user_id on credit_audit_log(user_id);
create index if not exists idx_credit_audit_log_created_at on credit_audit_log(created_at);

alter table credit_audit_log enable row level security;

-- Same posture as admin_logs: nobody reads this from the client,
-- only the service role (server-side code), which bypasses RLS.
create policy "no_client_access_credit_audit_log" on credit_audit_log
  for select using (false);

-- Integrity check: run this periodically (e.g. a daily cron / Supabase
-- scheduled function) to catch drift between the fast counter on
-- profiles and the append-only ledger. Any row it returns means
-- credits_used was changed by something other than deductCredit().
create or replace view credit_audit_mismatches as
select
  p.id as user_id,
  p.credits_used as profile_credits_used,
  coalesce(sum(l.credits_consumed) filter (where l.status = 'success'), 0) as ledger_credits_used,
  p.credits_used - coalesce(sum(l.credits_consumed) filter (where l.status = 'success'), 0) as drift
from profiles p
left join credit_audit_log l on l.user_id = p.id
group by p.id, p.credits_used
having p.credits_used <> coalesce(sum(l.credits_consumed) filter (where l.status = 'success'), 0);
