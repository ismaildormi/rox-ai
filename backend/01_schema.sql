-- ROX AI — Database Schema (Supabase / PostgreSQL)
-- Run this in Supabase → SQL Editor

create table if not exists profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text unique,
  full_name text,
  subscription_status text default 'free',      -- 'free' | 'pro'
  credits_total integer default 800,             -- starting credit allowance (lowered from 20000 to cap free-tier cost exposure)
  credits_used integer default 0,
  last_reset_date timestamp with time zone default timezone('utc'::text, now())
);

-- Optional: activity log used by the gatekeeper for auditing
create table if not exists admin_logs (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete cascade,
  action text,
  status text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
