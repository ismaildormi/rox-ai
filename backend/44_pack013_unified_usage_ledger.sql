-- ZUVYR Pack 013 — Unified Usage Ledger
do $pack013$
begin
  if to_regclass('public.zuvyr_usage_records') is null
     or to_regclass('public.credit_audit_log') is null
  then
    raise exception 'pack013_usage_ledger_prerequisites_missing';
  end if;
end
$pack013$;

alter table public.zuvyr_usage_records add column if not exists project_id text;
alter table public.zuvyr_usage_records add column if not exists task_id text;
alter table public.zuvyr_usage_records add column if not exists step_id text default 'root';
alter table public.zuvyr_usage_records add column if not exists usage_kind text default 'request';
alter table public.zuvyr_usage_records add column if not exists ledger_source text default 'canonical';
alter table public.zuvyr_usage_records add column if not exists cost_known boolean default true;
alter table public.zuvyr_usage_records add column if not exists accounting_state text generated always as (
  case
    when state = 'reserved' then 'reserved'
    when state = 'settled' then 'used'
    when state = 'refunded' then 'refunded'
    when state = 'failed' then 'available'
    else 'available'
  end
) stored;

update public.zuvyr_usage_records
set task_id=coalesce(nullif(trim(task_id),''),request_id),
    step_id=coalesce(nullif(trim(step_id),''),'root'),
    usage_kind=coalesce(nullif(trim(usage_kind),''),'request'),
    ledger_source=coalesce(nullif(trim(ledger_source),''),'canonical'),
    cost_known=coalesce(cost_known,true)
where task_id is null or nullif(trim(task_id),'') is null
   or step_id is null or nullif(trim(step_id),'') is null
   or usage_kind is null or nullif(trim(usage_kind),'') is null
   or ledger_source is null or nullif(trim(ledger_source),'') is null
   or cost_known is null;

alter table public.zuvyr_usage_records alter column task_id set not null;
alter table public.zuvyr_usage_records alter column step_id set not null;
alter table public.zuvyr_usage_records alter column usage_kind set not null;
alter table public.zuvyr_usage_records alter column ledger_source set not null;
alter table public.zuvyr_usage_records alter column cost_known set not null;

alter table public.zuvyr_usage_records drop constraint if exists zuvyr_usage_funding_source_allowed;
alter table public.zuvyr_usage_records add constraint zuvyr_usage_funding_source_allowed
check (funding_source = any(array['subscription'::text,'topup'::text,'legacy_credit'::text]));

do $pack013$
begin
  if not exists (select 1 from pg_constraint where conname='zuvyr_usage_task_id_valid' and conrelid='public.zuvyr_usage_records'::regclass) then
    alter table public.zuvyr_usage_records add constraint zuvyr_usage_task_id_valid check (length(trim(task_id)) between 1 and 200) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='zuvyr_usage_step_id_valid' and conrelid='public.zuvyr_usage_records'::regclass) then
    alter table public.zuvyr_usage_records add constraint zuvyr_usage_step_id_valid check (length(trim(step_id)) between 1 and 128) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='zuvyr_usage_kind_valid' and conrelid='public.zuvyr_usage_records'::regclass) then
    alter table public.zuvyr_usage_records add constraint zuvyr_usage_kind_valid check (length(trim(usage_kind)) between 1 and 80) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='zuvyr_usage_project_id_valid' and conrelid='public.zuvyr_usage_records'::regclass) then
    alter table public.zuvyr_usage_records add constraint zuvyr_usage_project_id_valid check (project_id is null or length(trim(project_id)) between 1 and 200) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='zuvyr_usage_ledger_source_valid' and conrelid='public.zuvyr_usage_records'::regclass) then
    alter table public.zuvyr_usage_records add constraint zuvyr_usage_ledger_source_valid check (ledger_source in ('canonical','legacy_credit_compat')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='zuvyr_usage_accounting_state_valid' and conrelid='public.zuvyr_usage_records'::regclass) then
    alter table public.zuvyr_usage_records add constraint zuvyr_usage_accounting_state_valid check (accounting_state in ('available','reserved','used','refunded')) not valid;
  end if;
end
$pack013$;

alter table public.zuvyr_usage_records validate constraint zuvyr_usage_task_id_valid;
alter table public.zuvyr_usage_records validate constraint zuvyr_usage_step_id_valid;
alter table public.zuvyr_usage_records validate constraint zuvyr_usage_kind_valid;
alter table public.zuvyr_usage_records validate constraint zuvyr_usage_project_id_valid;
alter table public.zuvyr_usage_records validate constraint zuvyr_usage_ledger_source_valid;
alter table public.zuvyr_usage_records validate constraint zuvyr_usage_accounting_state_valid;

create index if not exists zuvyr_usage_task_step_created_idx on public.zuvyr_usage_records(task_id,step_id,created_at desc);
create index if not exists zuvyr_usage_project_created_idx on public.zuvyr_usage_records(project_id,created_at desc) where project_id is not null;

create or replace function public.normalize_zuvyr_usage_identity()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  new.task_id:=coalesce(nullif(trim(new.task_id),''),trim(new.request_id));
  new.step_id:=coalesce(nullif(trim(new.step_id),''),'root');
  new.usage_kind:=coalesce(nullif(trim(new.usage_kind),''),'request');
  new.ledger_source:=coalesce(nullif(trim(new.ledger_source),''),'canonical');
  if new.project_id is not null then new.project_id:=nullif(trim(new.project_id),''); end if;
  return new;
end
$fn$;

drop trigger if exists trg_normalize_zuvyr_usage_identity on public.zuvyr_usage_records;
create trigger trg_normalize_zuvyr_usage_identity
before insert or update of request_id,project_id,task_id,step_id,usage_kind,ledger_source
on public.zuvyr_usage_records for each row execute function public.normalize_zuvyr_usage_identity();
revoke all on function public.normalize_zuvyr_usage_identity() from public, anon, authenticated;

create or replace function public.sync_legacy_credit_audit_to_usage()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_request_id text; v_reserved integer; v_actual integer; v_refunded integer; v_state text;
  v_capability text; v_model_tool text; v_pricing_version text; v_task_id text; v_step_id text;
  v_project_id text; v_usage_kind text; v_existing_source text;
begin
  v_request_id:=nullif(trim(new.request_id),'');
  if v_request_id is null or new.status not in ('success','refunded') then return new; end if;

  v_reserved:=greatest(coalesce(new.reserved_credits,new.credits_consumed,0),coalesce(new.credits_consumed,0));
  -- Zero-credit audit/log events are not metered usage and must not violate the positive-reservation ledger invariant.
  if v_reserved <= 0 then return new; end if;
  if new.status='refunded' then
    v_state:='refunded'; v_actual:=0; v_refunded:=v_reserved;
  elsif new.settled_final_credits is not null or coalesce(new.metadata->>'settled','false')='true' then
    v_state:='settled'; v_actual:=coalesce(new.settled_final_credits,new.credits_consumed,0); v_refunded:=greatest(v_reserved-v_actual,0);
  else
    v_state:='reserved'; v_actual:=null; v_refunded:=0;
  end if;

  v_capability:=coalesce(nullif(lower(trim(new.feature)),''),'legacy');
  v_model_tool:=coalesce(nullif(trim(new.model_used),''),v_capability);
  v_pricing_version:=coalesce(nullif(trim(new.metadata->>'pricing_version'),''),nullif(trim(new.metadata->>'pricingVersion'),''),'legacy-credit-v1');
  v_task_id:=coalesce(nullif(trim(new.metadata->>'task_id'),''),nullif(trim(new.metadata->>'taskId'),''),v_request_id);
  v_step_id:=coalesce(nullif(trim(new.metadata->>'step_id'),''),nullif(trim(new.metadata->>'stepId'),''),'root');
  v_project_id:=coalesce(nullif(trim(new.metadata->>'project_id'),''),nullif(trim(new.metadata->>'projectId'),''));
  v_usage_kind:=coalesce(nullif(trim(new.metadata->>'usage_kind'),''),nullif(trim(new.metadata->>'usageKind'),''),
    case when v_capability='code' then 'ai_code_edit'
         when v_capability in ('image','video') then 'generation'
         when v_capability='chat' then 'chat_request'
         else 'request' end);

  select ledger_source into v_existing_source from public.zuvyr_usage_records where request_id=v_request_id for update;
  if found and v_existing_source is distinct from 'legacy_credit_compat' then
    raise exception 'pack013_cross_ledger_request_conflict';
  end if;

  insert into public.zuvyr_usage_records(
    user_id,request_id,idempotency_key,capability,provider,model_tool,pricing_version,funding_source,
    reserved_credits,actual_credits,refunded_credits,estimated_provider_cost_microusd,
    actual_provider_cost_microusd,revenue_microusd,gross_profit_microusd,gross_margin_bps,
    provider_usage,state,task_id,step_id,project_id,usage_kind,ledger_source,cost_known,settled_at,updated_at
  ) values (
    new.user_id,v_request_id,'legacy:'||v_request_id,v_capability,
    coalesce(nullif(trim(new.metadata->>'provider'),''),'legacy-credit'),
    v_model_tool,v_pricing_version,'legacy_credit',v_reserved,v_actual,v_refunded,0,
    null,null,null,null,
    jsonb_build_object('source','legacy_credit_audit','costKnown',false,'legacyOriginalReservedCredits',coalesce(new.reserved_credits,new.credits_consumed,0)),
    v_state,v_task_id,v_step_id,v_project_id,v_usage_kind,'legacy_credit_compat',false,
    case when v_state in ('settled','refunded') then clock_timestamp() else null end,clock_timestamp()
  )
  on conflict (request_id) do update set
    capability=excluded.capability, provider=excluded.provider, model_tool=excluded.model_tool,
    pricing_version=excluded.pricing_version,
    reserved_credits=greatest(public.zuvyr_usage_records.reserved_credits,excluded.reserved_credits),
    actual_credits=excluded.actual_credits, refunded_credits=excluded.refunded_credits,
    provider_usage=coalesce(public.zuvyr_usage_records.provider_usage,'{}'::jsonb)||excluded.provider_usage,
    state=excluded.state, task_id=excluded.task_id, step_id=excluded.step_id, project_id=excluded.project_id,
    usage_kind=excluded.usage_kind, ledger_source='legacy_credit_compat', cost_known=false,
    settled_at=excluded.settled_at, updated_at=clock_timestamp();

  return new;
end
$fn$;

drop trigger if exists trg_sync_legacy_credit_audit_to_usage on public.credit_audit_log;
create trigger trg_sync_legacy_credit_audit_to_usage
after insert or update of status,credits_consumed,reserved_credits,settled_final_credits,metadata
on public.credit_audit_log for each row execute function public.sync_legacy_credit_audit_to_usage();
revoke all on function public.sync_legacy_credit_audit_to_usage() from public, anon, authenticated;

-- Historical reconciliation: existing positive legacy credit records become rows in the same authoritative usage ledger.
-- The migration aborts rather than guessing if a request identity is duplicated or already owned by the canonical path.
do $pack013$
begin
  if exists (
    select 1
    from (
      select trim(request_id) as request_id
      from public.credit_audit_log
      where status in ('success','refunded')
        and request_id is not null
        and nullif(trim(request_id),'') is not null
        and greatest(coalesce(reserved_credits,credits_consumed,0),coalesce(credits_consumed,0)) > 0
      group by trim(request_id)
      having count(*) > 1
    ) d
  ) then
    raise exception 'pack013_duplicate_legacy_request_identity';
  end if;

  if exists (
    select 1
    from public.credit_audit_log a
    join public.zuvyr_usage_records u on u.request_id=trim(a.request_id)
    where a.status in ('success','refunded')
      and a.request_id is not null
      and nullif(trim(a.request_id),'') is not null
      and greatest(coalesce(a.reserved_credits,a.credits_consumed,0),coalesce(a.credits_consumed,0)) > 0
      and u.ledger_source is distinct from 'legacy_credit_compat'
  ) then
    raise exception 'pack013_historical_cross_ledger_conflict';
  end if;

  if exists (
    select 1
    from public.credit_audit_log a
    join public.zuvyr_usage_records u on u.idempotency_key='legacy:'||trim(a.request_id)
    where a.status in ('success','refunded')
      and a.request_id is not null
      and nullif(trim(a.request_id),'') is not null
      and greatest(coalesce(a.reserved_credits,a.credits_consumed,0),coalesce(a.credits_consumed,0)) > 0
      and u.request_id is distinct from trim(a.request_id)
  ) then
    raise exception 'pack013_historical_idempotency_conflict';
  end if;
end
$pack013$;

insert into public.zuvyr_usage_records(
  user_id,request_id,idempotency_key,capability,provider,model_tool,pricing_version,funding_source,
  reserved_credits,actual_credits,refunded_credits,estimated_provider_cost_microusd,
  actual_provider_cost_microusd,revenue_microusd,gross_profit_microusd,gross_margin_bps,
  provider_usage,state,task_id,step_id,project_id,usage_kind,ledger_source,cost_known,
  created_at,settled_at,updated_at
)
select
  a.user_id,
  trim(a.request_id),
  'legacy:'||trim(a.request_id),
  coalesce(nullif(lower(trim(a.feature)),''),'legacy'),
  coalesce(nullif(trim(a.metadata->>'provider'),''),'legacy-credit'),
  coalesce(nullif(trim(a.model_used),''),coalesce(nullif(lower(trim(a.feature)),''),'legacy')),
  coalesce(nullif(trim(a.metadata->>'pricing_version'),''),nullif(trim(a.metadata->>'pricingVersion'),''),'legacy-credit-v1'),
  'legacy_credit',
  greatest(coalesce(a.reserved_credits,a.credits_consumed,0),coalesce(a.credits_consumed,0)),
  case
    when a.status='refunded' then 0
    when a.settled_final_credits is not null or coalesce(a.metadata->>'settled','false')='true'
      then coalesce(a.settled_final_credits,a.credits_consumed,0)
    else null
  end,
  case
    when a.status='refunded' then greatest(coalesce(a.reserved_credits,a.credits_consumed,0),coalesce(a.credits_consumed,0))
    when a.settled_final_credits is not null or coalesce(a.metadata->>'settled','false')='true'
      then greatest(
        greatest(coalesce(a.reserved_credits,a.credits_consumed,0),coalesce(a.credits_consumed,0))
        - coalesce(a.settled_final_credits,a.credits_consumed,0),
        0
      )
    else 0
  end,
  0,null,null,null,null,
  jsonb_build_object(
    'source','legacy_credit_audit',
    'costKnown',false,
    'legacyOriginalReservedCredits',coalesce(a.reserved_credits,a.credits_consumed,0)
  ),
  case
    when a.status='refunded' then 'refunded'
    when a.settled_final_credits is not null or coalesce(a.metadata->>'settled','false')='true' then 'settled'
    else 'reserved'
  end,
  coalesce(nullif(trim(a.metadata->>'task_id'),''),nullif(trim(a.metadata->>'taskId'),''),trim(a.request_id)),
  coalesce(nullif(trim(a.metadata->>'step_id'),''),nullif(trim(a.metadata->>'stepId'),''),'root'),
  coalesce(nullif(trim(a.metadata->>'project_id'),''),nullif(trim(a.metadata->>'projectId'),'')),
  coalesce(
    nullif(trim(a.metadata->>'usage_kind'),''),
    nullif(trim(a.metadata->>'usageKind'),''),
    case
      when lower(trim(a.feature))='code' then 'ai_code_edit'
      when lower(trim(a.feature)) in ('image','video') then 'generation'
      when lower(trim(a.feature))='chat' then 'chat_request'
      else 'request'
    end
  ),
  'legacy_credit_compat',false,
  coalesce(a.created_at,clock_timestamp()),
  case
    when a.status='refunded'
      or a.settled_final_credits is not null
      or coalesce(a.metadata->>'settled','false')='true'
      then coalesce(a.created_at,clock_timestamp())
    else null
  end,
  clock_timestamp()
from public.credit_audit_log a
where a.status in ('success','refunded')
  and a.request_id is not null
  and nullif(trim(a.request_id),'') is not null
  and greatest(coalesce(a.reserved_credits,a.credits_consumed,0),coalesce(a.credits_consumed,0)) > 0
on conflict (request_id) do nothing;


create or replace function public.reserve_zuvyr_usage_contract(
  p_user_id uuid,p_request_id text,p_idempotency_key text,p_capability text,p_provider text,
  p_model_tool text,p_pricing_version text,p_reserved_credits integer,p_estimated_provider_cost_microusd numeric,
  p_allow_topup boolean,p_enforcement_enabled boolean,p_project_id text default null,p_task_id text default null,
  p_step_id text default 'root',p_usage_kind text default 'request'
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare v_result jsonb;
begin
  if nullif(trim(p_task_id),'') is not null and length(trim(p_task_id))>200 then
    return jsonb_build_object('success',false,'error','invalid_task_id');
  end if;
  if nullif(trim(p_step_id),'') is null or length(trim(p_step_id))>128 then
    return jsonb_build_object('success',false,'error','invalid_step_id');
  end if;
  if nullif(trim(p_usage_kind),'') is null or length(trim(p_usage_kind))>80 then
    return jsonb_build_object('success',false,'error','invalid_usage_kind');
  end if;
  if p_project_id is not null and (nullif(trim(p_project_id),'') is null or length(trim(p_project_id))>200) then
    return jsonb_build_object('success',false,'error','invalid_project_id');
  end if;

  v_result:=public.reserve_zuvyr_usage(
    p_user_id,p_request_id,p_idempotency_key,p_capability,p_provider,p_model_tool,p_pricing_version,
    p_reserved_credits,p_estimated_provider_cost_microusd,p_allow_topup,p_enforcement_enabled
  );

  if coalesce((v_result->>'success')::boolean,false) then
    update public.zuvyr_usage_records set
      project_id=nullif(trim(p_project_id),''),
      task_id=coalesce(nullif(trim(p_task_id),''),trim(p_request_id)),
      step_id=trim(p_step_id),usage_kind=trim(p_usage_kind),ledger_source='canonical',cost_known=true
    where request_id=trim(p_request_id);
  end if;

  return v_result||jsonb_build_object('ledger_contract',jsonb_build_object(
    'request_id',trim(p_request_id),'project_id',nullif(trim(p_project_id),''),
    'task_id',coalesce(nullif(trim(p_task_id),''),trim(p_request_id)),
    'step_id',trim(p_step_id),'usage_kind',trim(p_usage_kind)
  ));
end
$fn$;

revoke execute on function public.reserve_zuvyr_usage_contract(
  uuid,text,text,text,text,text,text,integer,numeric,boolean,boolean,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.reserve_zuvyr_usage_contract(
  uuid,text,text,text,text,text,text,integer,numeric,boolean,boolean,text,text,text,text
) to service_role;
