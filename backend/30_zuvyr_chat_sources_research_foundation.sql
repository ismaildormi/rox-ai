-- ZUVYR V1 Pack 03: durable Chat sources and external-mode run records.
-- Additive only. Web Search, Deep Research and Shopping stay disabled.

create table if not exists public.conversation_sources (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.shared_conversations(id) on delete cascade,
  message_id bigint not null references public.conversation_messages(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null,
  citation_key text not null,
  title text not null,
  url text,
  snippet text not null default '',
  asset_id uuid references public.conversation_assets(id) on delete set null,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint conversation_sources_message_citation_unique unique (message_id, citation_key),
  constraint conversation_sources_type_allowed check (source_type in ('file', 'web', 'product', 'memory')),
  constraint conversation_sources_title_valid check (length(trim(title)) between 1 and 240),
  constraint conversation_sources_snippet_valid check (length(snippet) <= 1200),
  constraint conversation_sources_url_valid check (
    (source_type in ('file', 'memory') and (url is null or url like 'https://%'))
    or (source_type in ('web', 'product') and url like 'https://%')
  )
);

create table if not exists public.zuvyr_chat_capability_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  conversation_id uuid references public.shared_conversations(id) on delete cascade,
  request_id text not null,
  mode text not null,
  state text not null default 'pending',
  query text not null,
  plan jsonb not null default '{}'::jsonb,
  result jsonb,
  usage_record_id bigint references public.zuvyr_usage_records(id) on delete restrict,
  error_code text,
  cancel_requested boolean not null default false,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint zuvyr_chat_capability_request_unique unique (owner_id, request_id),
  constraint zuvyr_chat_capability_mode_allowed check (mode in ('web_search', 'deep_research', 'shopping')),
  constraint zuvyr_chat_capability_state_allowed check (state in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  constraint zuvyr_chat_capability_query_valid check (length(trim(query)) between 1 and 1000)
);

create index if not exists conversation_sources_conversation_message_idx
  on public.conversation_sources (conversation_id, message_id, created_at);
create index if not exists conversation_sources_owner_type_idx
  on public.conversation_sources (owner_id, source_type, created_at desc);
create index if not exists zuvyr_chat_capability_runs_state_idx
  on public.zuvyr_chat_capability_runs (state, updated_at);

alter table public.conversation_sources enable row level security;
alter table public.zuvyr_chat_capability_runs enable row level security;

revoke all on table public.conversation_sources from public, anon, authenticated;
revoke all on table public.zuvyr_chat_capability_runs from public, anon, authenticated;
grant select, insert, update on table public.conversation_sources to service_role;
grant select, insert, update on table public.zuvyr_chat_capability_runs to service_role;

comment on table public.conversation_sources is
  'Pack 03 normalized citations for files, web results, products and memory.';
comment on table public.zuvyr_chat_capability_runs is
  'Pack 03 external Chat-mode runs; activation and execution are separate.';
