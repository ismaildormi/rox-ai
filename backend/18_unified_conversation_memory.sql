-- ROX AI - Unified durable conversation memory
--
-- Shared foundation for Chat, Code Studio, AI Images, AI Video and Rox IP.
-- Existing shared_conversations.content snapshots remain intact for backward
-- compatibility. New normalized rows support long conversations without
-- sending the entire transcript to an AI provider on every request.

begin;

alter table shared_conversations
  add column if not exists title text,
  add column if not exists feature text not null default 'chat',
  add column if not exists pinned boolean not null default false,
  add column if not exists archived boolean not null default false,
  add column if not exists message_count integer not null default 0,
  add column if not exists memory_summary text not null default '',
  add column if not exists memory_state jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_message_at timestamptz not null default now();

-- Preserve and classify every legacy snapshot.
update shared_conversations
set feature = case
  when lower(coalesce(content->>'feature', 'chat')) in
    ('chat', 'code', 'images', 'videos', 'roxip')
    then lower(content->>'feature')
  when lower(coalesce(content->>'feature', 'chat')) = 'image'
    then 'images'
  when lower(coalesce(content->>'feature', 'chat')) = 'video'
    then 'videos'
  else 'chat'
end;

update shared_conversations
set title = coalesce(
  nullif(
    left(
      regexp_replace(
        coalesce(
          content #>> '{messages,0,content}',
          content #>> '{assistant,content}',
          'Saved conversation'
        ),
        E'\\s+',
        ' ',
        'g'
      ),
      80
    ),
    ''
  ),
  'Saved conversation'
)
where title is null or btrim(title) = '';

update shared_conversations
set message_count = least(
  1000,
  (
    case
      when jsonb_typeof(content->'messages') = 'array'
        then jsonb_array_length(content->'messages')
      else 0
    end
  ) +
  (
    case
      when jsonb_typeof(content->'assistant') = 'object'
        then 1
      else 0
    end
  )
)
where message_count = 0;

update shared_conversations
set metadata = metadata || jsonb_build_object(
  'legacy_snapshot',
  true,
  'memory_version',
  1
)
where content is not null
  and not (metadata ? 'memory_version');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shared_conversations_feature_check'
  ) then
    alter table shared_conversations
      add constraint shared_conversations_feature_check
      check (feature in ('chat', 'code', 'images', 'videos', 'roxip'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'shared_conversations_message_count_check'
  ) then
    alter table shared_conversations
      add constraint shared_conversations_message_count_check
      check (message_count between 0 and 1000);
  end if;
end
$$;

create table if not exists conversation_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null
    references shared_conversations(id) on delete cascade,
  owner_id uuid not null
    references profiles(id) on delete cascade,
  sequence_no integer not null,
  role text not null,
  message_type text not null default 'text',
  plain_text text not null default '',
  content jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  provider text,
  model text,
  request_id text,
  created_at timestamptz not null default now(),
  unique (conversation_id, sequence_no),
  check (sequence_no between 1 and 1000),
  check (role in ('user', 'assistant', 'system', 'tool')),
  check (
    message_type in (
      'text',
      'code',
      'image',
      'video',
      'audio',
      'file',
      'roxip_event',
      'status'
    )
  )
);

create table if not exists conversation_assets (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references shared_conversations(id) on delete cascade,
  message_id bigint
    references conversation_messages(id) on delete cascade,
  owner_id uuid not null
    references profiles(id) on delete cascade,
  asset_type text not null,
  url text,
  storage_path text,
  mime_type text,
  original_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    asset_type in (
      'image',
      'video',
      'audio',
      'file',
      'code',
      'reference'
    )
  ),
  check (url is not null or storage_path is not null)
);

alter table generation_jobs
  add column if not exists conversation_id uuid
    references shared_conversations(id) on delete set null,
  add column if not exists request_message_id bigint
    references conversation_messages(id) on delete set null,
  add column if not exists response_message_id bigint
    references conversation_messages(id) on delete set null;

create index if not exists idx_shared_conversations_owner_updated
  on shared_conversations(owner_id, updated_at desc);

create index if not exists idx_shared_conversations_owner_feature
  on shared_conversations(owner_id, feature, archived, pinned);

create index if not exists idx_shared_conversations_owner_search
  on shared_conversations(owner_id, lower(title));

create index if not exists idx_conversation_messages_conversation_sequence
  on conversation_messages(conversation_id, sequence_no);

create index if not exists idx_conversation_messages_owner_created
  on conversation_messages(owner_id, created_at desc);

create unique index if not exists idx_conversation_messages_request_id
  on conversation_messages(conversation_id, request_id)
  where request_id is not null;

create index if not exists idx_conversation_assets_conversation
  on conversation_assets(conversation_id, created_at);

create unique index if not exists idx_conversation_assets_message_type
  on conversation_assets(conversation_id, message_id, asset_type);

create index if not exists idx_generation_jobs_conversation
  on generation_jobs(conversation_id, created_at desc);

alter table conversation_messages enable row level security;
alter table conversation_assets enable row level security;

drop policy if exists service_role_only on conversation_messages;
create policy service_role_only
  on conversation_messages
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists service_role_only on conversation_assets;
create policy service_role_only
  on conversation_assets
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Atomically append one ordered message and enforce the 1000-message ceiling.
-- The backend calls this through supabaseAdmin; no browser receives execute
-- permission and no client can choose another user's conversation.
create or replace function rox_append_conversation_message(
  p_conversation_id uuid,
  p_owner_id uuid,
  p_role text,
  p_message_type text default 'text',
  p_plain_text text default '',
  p_content jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_provider text default null,
  p_model text default null,
  p_request_id text default null
)
returns conversation_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
  inserted_message conversation_messages%rowtype;
begin
  select message_count
  into current_count
  from shared_conversations
  where id = p_conversation_id
    and owner_id = p_owner_id
    and archived = false
  for update;

  if not found then
    raise exception 'conversation_not_found'
      using errcode = 'P0002';
  end if;

  if p_request_id is not null then
    select *
    into inserted_message
    from conversation_messages
    where conversation_id = p_conversation_id
      and request_id = p_request_id;

    if found then
      return inserted_message;
    end if;
  end if;

  if current_count >= 1000 then
    raise exception 'conversation_message_limit'
      using errcode = 'P0001';
  end if;

  insert into conversation_messages (
    conversation_id,
    owner_id,
    sequence_no,
    role,
    message_type,
    plain_text,
    content,
    metadata,
    provider,
    model,
    request_id
  )
  values (
    p_conversation_id,
    p_owner_id,
    current_count + 1,
    p_role,
    coalesce(nullif(p_message_type, ''), 'text'),
    coalesce(p_plain_text, ''),
    coalesce(p_content, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb),
    p_provider,
    p_model,
    p_request_id
  )
  returning *
  into inserted_message;

  update shared_conversations
  set message_count = current_count + 1,
      last_message_at = inserted_message.created_at,
      updated_at = inserted_message.created_at
  where id = p_conversation_id
    and owner_id = p_owner_id;

  return inserted_message;
end;
$$;

revoke all on function rox_append_conversation_message(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb,
  text,
  text,
  text
) from public;

grant execute on function rox_append_conversation_message(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb,
  text,
  text,
  text
) to service_role;
create or replace function rox_touch_conversation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_rox_touch_conversation_updated_at
  on shared_conversations;

create trigger trg_rox_touch_conversation_updated_at
before update on shared_conversations
for each row
execute function rox_touch_conversation_updated_at();

comment on table conversation_messages is
  'Durable ordered Rox messages shared by Chat, Code, Images, Video and Rox IP.';

comment on table conversation_assets is
  'Images, videos, audio, files, code and references attached to Rox conversations.';

comment on column shared_conversations.memory_summary is
  'Rolling provider-safe summary used with recent turns instead of sending the full transcript.';

comment on column shared_conversations.memory_state is
  'Structured durable facts, decisions, project state and feature-specific context.';

commit;