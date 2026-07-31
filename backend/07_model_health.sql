-- ROX AI — 07_model_health.sql
-- aiRouter.js currently has NO memory of which model is down — every
-- single request retries the full Claude → Qwen → DeepSeek chain from
-- scratch, even if Claude has been failing for the last 500 requests.
-- That wastes up to PRIMARY_TIMEOUT_MS (15s) per request on a model
-- that's known to be dead, and it's invisible across server replicas.
--
-- This adds real circuit-breaker state, shared across every server
-- instance because it lives here in Postgres (Supabase), not in any
-- one process's memory. lib/modelHealth.js caches reads in Redis for
-- speed but always writes through to this table.

create table if not exists model_health (
  model text primary key,               -- e.g. 'claude-sonnet-5', 'qwen/qwen3-coder-480b:free'
  state text not null default 'closed',  -- 'closed' | 'open' | 'half_open'
  consecutive_failures integer not null default 0,
  opened_at timestamp with time zone,
  half_open_probe_at timestamp with time zone,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

alter table model_health enable row level security;

-- Same posture as the other operational tables: only the service role
-- (server-side code) ever touches this.
create policy "no_client_access_model_health" on model_health
  for select using (false);

-- ============================================================
-- circuit_check: call BEFORE attempting a model. Atomically performs
-- the open -> half_open transition once the cooldown has elapsed, and
-- tells the caller whether this attempt is the one allowed probe.
-- ============================================================
create or replace function circuit_check(
  p_model text,
  p_open_cooldown_seconds integer default 30
)
returns json as $$
declare
  v_row model_health%rowtype;
begin
  insert into model_health (model) values (p_model)
  on conflict (model) do nothing;

  select * into v_row from model_health where model = p_model for update;

  if v_row.state = 'closed' then
    return json_build_object('allowed', true, 'is_probe', false);
  end if;

  if v_row.state = 'open' then
    if v_row.opened_at is not null
       and now() >= v_row.opened_at + (p_open_cooldown_seconds || ' seconds')::interval then
      update model_health
      set state = 'half_open', half_open_probe_at = now()
      where model = p_model;
      return json_build_object('allowed', true, 'is_probe', true);
    end if;
    return json_build_object('allowed', false, 'is_probe', false);
  end if;

  if v_row.state = 'half_open' then
    -- Guard against a thundering herd of probes from concurrent requests:
    -- only let a fresh probe through if the last one was issued a few
    -- seconds ago (it likely already failed/succeeded and should have
    -- moved state by now, so this is just a safety valve).
    if v_row.half_open_probe_at is not null and now() - v_row.half_open_probe_at < interval '5 seconds' then
      return json_build_object('allowed', false, 'is_probe', false);
    end if;
    update model_health set half_open_probe_at = now() where model = p_model;
    return json_build_object('allowed', true, 'is_probe', true);
  end if;

  return json_build_object('allowed', true, 'is_probe', false);
end;
$$ language plpgsql security definer;

-- ============================================================
-- circuit_report: call AFTER attempting a model, with the outcome.
-- ============================================================
create or replace function circuit_report(
  p_model text,
  p_success boolean,
  p_failure_threshold integer default 5
)
returns void as $$
declare
  v_row model_health%rowtype;
begin
  insert into model_health (model) values (p_model)
  on conflict (model) do nothing;

  select * into v_row from model_health where model = p_model for update;

  if p_success then
    update model_health
    set state = 'closed', consecutive_failures = 0, opened_at = null, half_open_probe_at = null, updated_at = now()
    where model = p_model;
    return;
  end if;

  if v_row.state = 'half_open' then
    -- The probe failed: straight back to open, restart the cooldown clock.
    update model_health
    set state = 'open', consecutive_failures = v_row.consecutive_failures + 1,
        opened_at = now(), half_open_probe_at = null, updated_at = now()
    where model = p_model;
    return;
  end if;

  if v_row.consecutive_failures + 1 >= p_failure_threshold then
    update model_health
    set state = 'open', consecutive_failures = v_row.consecutive_failures + 1,
        opened_at = now(), half_open_probe_at = null, updated_at = now()
    where model = p_model;
  else
    update model_health
    set consecutive_failures = v_row.consecutive_failures + 1, updated_at = now()
    where model = p_model;
  end if;
end;
$$ language plpgsql security definer;
