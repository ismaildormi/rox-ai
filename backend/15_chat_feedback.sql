-- Rox AI chat response feedback
-- Stores one like/dislike per user and AI response.

create table if not exists chat_response_feedback (
  id uuid default gen_random_uuid() primary key,
  response_id uuid not null,
  user_id uuid references profiles(id) on delete cascade not null,
  feature text not null default 'chat'
    check (feature in ('chat', 'code')),
  rating smallint not null
    check (rating in (-1, 1)),
  model text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone
    not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone
    not null default timezone('utc'::text, now()),

  unique (user_id, response_id)
);

create index if not exists idx_chat_feedback_user_id
  on chat_response_feedback(user_id);

create index if not exists idx_chat_feedback_response_id
  on chat_response_feedback(response_id);

create index if not exists idx_chat_feedback_rating
  on chat_response_feedback(rating);

alter table chat_response_feedback enable row level security;

-- The authenticated user may only read their own feedback.
-- Insert/update/delete will be handled by the backend service role.
create policy "select_own_chat_feedback"
  on chat_response_feedback
  for select
  using (auth.uid() = user_id);