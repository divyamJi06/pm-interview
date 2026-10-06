
-- PM Interview Prep — initial Supabase schema.
--
-- Run this once in the Supabase dashboard (SQL Editor) or with `supabase db push`.
-- It is safe to re-run: every object is created with IF NOT EXISTS / OR REPLACE.
--
-- Auth is owned by Supabase (auth.users). This file adds the application tables
-- and the row level security policies that keep each candidate's data private.

-- ---------------------------------------------------------------------------
-- profiles — one row per signed-in candidate. Created automatically on signup.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text not null default '',
  -- Kept in sync from auth.users on insert; the candidate can still edit it.
  email text not null default '',
  target_role text not null default '',
  years_experience numeric,
  resume_text text not null default '',
  resume_file_name text not null default '',
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.resume_text is
  'First 8000 characters of the pasted resume. The interview engine truncates at the same limit.';

-- ---------------------------------------------------------------------------
-- interviews — one row per interview the candidate runs.
--
-- `session_id` is the id minted by the Node interview engine. It is the join key
-- back to /api/report/:sessionId while a run is still in flight; the dashboard
-- only reads rows from Supabase, so a finished interview survives a server
-- restart.
--
-- `stage` is one of the gradeable rounds the engine knows about:
--   estimation | product_design | case_study | strategy |
--   execution_metrics | technical | behavioral
-- or null for a full mock interview that walks the whole sequence.
-- ---------------------------------------------------------------------------
create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id text not null,
  mode text not null default 'mock' check (mode in ('mock', 'practice')),
  stage text,
  status text not null default 'live' check (status in ('live', 'completed', 'abandoned')),
  feedback_mode text not null default 'full' check (feedback_mode in ('full', 'simulation')),
  voice_mode boolean not null default false,
  target_role text not null default '',
  question_count integer not null default 0,
  answer_count integer not null default 0,
  -- Overall 0-100 verdict the engine produced, if any.
  overall_score numeric,
  -- Per-dimension scores for this interview, e.g.
  --   {"product_thinking": 72, "execution": 65, "communication": 80}
  stage_scores jsonb not null default '{}'::jsonb,
  -- Strongest and weakest dimension names, denormalised so the dashboard can
  -- sort and filter without opening every report.
  strongest_dimension text,
  weakest_dimension text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists interviews_user_started_idx
  on public.interviews (user_id, started_at desc);

create unique index if not exists interviews_user_session_idx
  on public.interviews (user_id, session_id);

-- ---------------------------------------------------------------------------
-- interview_reports — the full engine payload for a finished interview.
--
-- The payload shape is whatever /api/report/:sessionId returns (final report,
-- per-stage synthesis, transcript triples, coach action plan). It is stored as
-- jsonb rather than shredded into columns because it changes with the prompts,
-- and the dashboard only ever needs a few extracted numbers, which live on
-- `interviews`.
-- ---------------------------------------------------------------------------
create table if not exists public.interview_reports (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  report jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists interview_reports_interview_idx
  on public.interview_reports (interview_id);

create unique index if not exists interview_reports_interview_uniq
  on public.interview_reports (interview_id);

-- ---------------------------------------------------------------------------
-- There is no api_keys table, and there is not going to be one.
--
-- A candidate's Cohere key stays in their browser's localStorage and is sent to
-- the interview server for the length of a single round. The server holds it in
-- memory only, so nothing we own is left behind afterwards. Storing the key in
-- Postgres would mean a live credential readable by anyone with database
-- access and sitting in backups outside our control, which is a worse trade
-- than asking someone to paste the key once per browser.
--
-- 002_drop_api_keys.sql removes the table from projects created from the earlier
-- draft of this file.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Signup hook: every new auth user gets a profile row immediately, so the app
-- never has to create one and race with its own first read.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row level security: every table is visible only to its owner.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.interviews enable row level security;
alter table public.interview_reports enable row level security;

drop policy if exists "profiles are self-service" on public.profiles;
create policy "profiles are self-service" on public.profiles
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "interviews are self-service" on public.interviews;
create policy "interviews are self-service" on public.interviews
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "reports are self-service" on public.interview_reports;
create policy "reports are self-service" on public.interview_reports
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
