begin;

alter table shared_conversations
  add column if not exists pinned_at timestamptz;

update shared_conversations
set pinned_at = coalesce(pinned_at, updated_at, created_at, now())
where pinned = true;

create index if not exists idx_shared_conversations_pinned_order
  on shared_conversations(
    owner_id,
    archived,
    pinned desc,
    pinned_at desc,
    last_message_at desc
  );

commit;
