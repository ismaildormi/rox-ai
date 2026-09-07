-- ZUVYR V1 Pack 05: Video operation, progress, preview and export foundation.
-- Additive only. All paid provider operations remain disabled until pricing,
-- usage settlement and provider behavior are independently verified.

alter table public.generation_jobs
  add column if not exists video_operation text not null default 'text_to_video',
  add column if not exists source_image_asset_id uuid
    references public.conversation_assets(id) on delete set null,
  add column if not exists source_video_asset_id uuid
    references public.conversation_assets(id) on delete set null,
  add column if not exists start_frame_asset_id uuid
    references public.conversation_assets(id) on delete set null,
  add column if not exists end_frame_asset_id uuid
    references public.conversation_assets(id) on delete set null,
  add column if not exists video_options jsonb not null default '{}'::jsonb,
  add column if not exists progress_percent smallint not null default 0,
  add column if not exists job_stage text not null default 'queued',
  add column if not exists estimated_seconds integer,
  add column if not exists cancel_requested boolean not null default false,
  add column if not exists preview_url text,
  add column if not exists export_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'generation_jobs_video_operation_allowed'
      and conrelid = 'public.generation_jobs'::regclass
  ) then
    alter table public.generation_jobs
      add constraint generation_jobs_video_operation_allowed check (
        feature <> 'video'
        or video_operation in (
          'text_to_video', 'image_to_video', 'edit', 'extend',
          'subtitles', 'enhance', 'export'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'generation_jobs_video_options_object'
      and conrelid = 'public.generation_jobs'::regclass
  ) then
    alter table public.generation_jobs
      add constraint generation_jobs_video_options_object check (
        jsonb_typeof(video_options) = 'object'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'generation_jobs_progress_valid'
      and conrelid = 'public.generation_jobs'::regclass
  ) then
    alter table public.generation_jobs
      add constraint generation_jobs_progress_valid check (
        progress_percent between 0 and 100
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'generation_jobs_stage_allowed'
      and conrelid = 'public.generation_jobs'::regclass
  ) then
    alter table public.generation_jobs
      add constraint generation_jobs_stage_allowed check (
        job_stage in (
          'queued', 'validating', 'provider', 'processing', 'preview',
          'export', 'done', 'failed', 'cancelled'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'generation_jobs_estimate_valid'
      and conrelid = 'public.generation_jobs'::regclass
  ) then
    alter table public.generation_jobs
      add constraint generation_jobs_estimate_valid check (
        estimated_seconds is null
        or estimated_seconds between 0 and 86400
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'generation_jobs_video_urls_https'
      and conrelid = 'public.generation_jobs'::regclass
  ) then
    alter table public.generation_jobs
      add constraint generation_jobs_video_urls_https check (
        (preview_url is null or preview_url like 'https://%')
        and (export_url is null or export_url like 'https://%')
      );
  end if;
end
$$;

create index if not exists generation_jobs_user_video_history_idx
  on public.generation_jobs (user_id, created_at desc)
  where feature = 'video';

create index if not exists generation_jobs_video_operation_state_idx
  on public.generation_jobs (video_operation, status, created_at desc)
  where feature = 'video';

create index if not exists generation_jobs_video_cancel_queue_idx
  on public.generation_jobs (cancel_requested, created_at)
  where feature = 'video' and status in ('queued', 'processing');

comment on column public.generation_jobs.video_operation is
  'Pack 05 Video operation; every paid operation is blocked pending verified pricing.';
comment on column public.generation_jobs.progress_percent is
  'Bounded progress snapshot for asynchronous Image/Video job status.';
comment on column public.generation_jobs.cancel_requested is
  'Cancellation intent foundation; runtime cancellation remains disabled by default.';
comment on column public.generation_jobs.preview_url is
  'HTTPS-only preview artifact URL written by the trusted worker.';
