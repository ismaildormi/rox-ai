-- ZUVYR V1 Pack 04: image-operation request lineage and durable job history.
-- Additive only. Advanced operations remain disabled until pricing and provider
-- adapters are independently verified.

alter table public.generation_jobs
  add column if not exists image_operation text not null default 'generate',
  add column if not exists reference_asset_ids jsonb not null default '[]'::jsonb,
  add column if not exists source_asset_id uuid
    references public.conversation_assets(id) on delete set null,
  add column if not exists mask_asset_id uuid
    references public.conversation_assets(id) on delete set null,
  add column if not exists image_options jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'generation_jobs_image_operation_allowed'
      and conrelid = 'public.generation_jobs'::regclass
  ) then
    alter table public.generation_jobs
      add constraint generation_jobs_image_operation_allowed check (
        feature <> 'image'
        or image_operation in (
          'generate',
          'reference_generate',
          'edit',
          'variations',
          'remove_background',
          'upscale',
          'inpaint',
          'expand'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'generation_jobs_reference_assets_array'
      and conrelid = 'public.generation_jobs'::regclass
  ) then
    alter table public.generation_jobs
      add constraint generation_jobs_reference_assets_array check (
        jsonb_typeof(reference_asset_ids) = 'array'
        and jsonb_array_length(reference_asset_ids) <= 4
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'generation_jobs_image_options_object'
      and conrelid = 'public.generation_jobs'::regclass
  ) then
    alter table public.generation_jobs
      add constraint generation_jobs_image_options_object check (
        jsonb_typeof(image_options) = 'object'
      );
  end if;
end
$$;

create index if not exists generation_jobs_user_image_history_idx
  on public.generation_jobs (user_id, created_at desc)
  where feature = 'image';

create index if not exists generation_jobs_image_operation_state_idx
  on public.generation_jobs (image_operation, status, created_at desc)
  where feature = 'image';

comment on column public.generation_jobs.image_operation is
  'Pack 04 image operation; only prompt generation is active by default.';
comment on column public.generation_jobs.reference_asset_ids is
  'Ordered image reference lineage, limited to four asset UUIDs.';
comment on column public.generation_jobs.image_options is
  'Validated image request options captured for history and later settlement.';
