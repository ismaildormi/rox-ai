-- ROX AI — Margin tracking
-- No schema migration needed: cost_usd / margin_usd / load_level were
-- added into credit_audit_log.metadata (jsonb) by server.js, not as new
-- columns — this view just reads them back out and aggregates.
--
-- Run this after 08_maintenance.sql.

create or replace view rox_margin_last_24h as
select
  feature,
  model_used,
  count(*) as requests,
  sum(credits_consumed) as credits_consumed,
  round(sum((metadata->>'cost_usd')::numeric), 6) as cost_usd,
  round(sum((metadata->>'margin_usd')::numeric), 6) as margin_usd,
  round(avg((metadata->>'margin_usd')::numeric), 6) as avg_margin_usd_per_request,
  count(*) filter (where metadata->>'load_level' = 'high') as requests_under_high_load,
  count(*) filter (where (metadata->>'chain_reordered')::boolean is true) as requests_cost_routed
from credit_audit_log
where status = 'success'
  and created_at > now() - interval '24 hours'
  and metadata ? 'cost_usd'
group by feature, model_used
order by margin_usd asc;

-- Same idea over 7 days, for spotting a slower drift rather than a spike.
create or replace view rox_margin_last_7d as
select
  feature,
  model_used,
  count(*) as requests,
  sum(credits_consumed) as credits_consumed,
  round(sum((metadata->>'cost_usd')::numeric), 6) as cost_usd,
  round(sum((metadata->>'margin_usd')::numeric), 6) as margin_usd,
  round(avg((metadata->>'margin_usd')::numeric), 6) as avg_margin_usd_per_request
from credit_audit_log
where status = 'success'
  and created_at > now() - interval '7 days'
  and metadata ? 'cost_usd'
group by feature, model_used
order by margin_usd asc;

-- Quick alert-style check: any (feature, model) combo that's been
-- net-negative over the last 24h. Empty result = healthy. Wire this
-- into the same maintenance job as check_credit_audit_mismatches()
-- (08_maintenance.sql) if you want it to raise a system_alerts row
-- automatically instead of being a manual query.
create or replace function check_negative_margin_last_24h()
returns table (feature text, model_used text, margin_usd numeric) as $$
begin
  return query
  select m.feature, m.model_used, m.margin_usd
  from rox_margin_last_24h m
  where m.margin_usd < 0;
end;
$$ language plpgsql security definer;
