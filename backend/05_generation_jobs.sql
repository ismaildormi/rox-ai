-- ROX AI — Generation Jobs
-- One row per queued heavy task (image/video). The API route enqueues
-- and returns immediately with a job id; the worker process (worker.js)
-- picks it up, runs it, and updates this row. The frontend polls
-- (or subscribes via Supabase Realtime) on job_id to show progress.

create table if not exists generation_jobs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  feature text not null,                -- 'image' | 'video'
  prompt text,
  status text not null default 'queued', -- 'queued' | 'processing' | 'done' | 'failed'
  result_url text,
  error_message text,
  bullmq_job_id text,                    -- cross-reference to the Redis-backed queue job
  created_at timestamp with time zone default timezone('utc'::text, now()),
  started_at timestamp with time zone,
  completed_at timestamp with time zone
);

create index if not exists idx_generation_jobs_user_id on generation_jobs(user_id);

alter table generation_jobs enable row level security;

-- Users can see the status of their own jobs (for the frontend poll/subscribe),
-- but can never insert/update directly — only the server (service role) does that.
create policy "select_own_jobs" on generation_jobs
  for select using (auth.uid() = user_id);
