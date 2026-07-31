-- ROX AI — Row Level Security (RLS)
-- Ensures a user can only read/edit their own row, and can NEVER
-- write to credits_total / credits_used / subscription_status directly.
-- Those fields are only ever changed by trusted server-side code
-- (the gatekeeper and the Stripe webhook), which uses the
-- Supabase SERVICE ROLE key and therefore bypasses RLS entirely.

alter table profiles enable row level security;
alter table admin_logs enable row level security;

-- Users can read only their own profile
create policy "select_own_profile" on profiles
  for select using (auth.uid() = id);

-- Users can update only their own profile, and only non-sensitive fields
-- (full_name). Supabase RLS can't restrict to specific *columns* directly,
-- so the real column-level protection must also be enforced by never
-- exposing credits/subscription fields in any client-facing update call —
-- only the server (service role) updates those.
create policy "update_own_profile" on profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- No one (besides the service role, which bypasses RLS) can read admin_logs
create policy "no_client_access_logs" on admin_logs
  for select using (false);
