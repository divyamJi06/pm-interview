-- PM Interview Prep — per-turn transcript storage.
--
-- Why this exists. Until now the only durable record of an interview was
-- `interviews` (a summary row) and `interview_reports` (one jsonb blob written
-- when the round ends). The questions, answers and per-answer analysis lived
-- in the Node engine's memory and in a JSON file under `sessions/`, so:
--
--   * a live round's transcript was unreadable from any other surface, and
--   * "Resume this round" only worked while the same server process still held
--     the session — which is why it used to dead-end.
--
-- `interview_turns` is the transcript as rows. One row per thing that happened,
-- written as it happens, so history and resume read the same data the round
-- produced.

-- ---------------------------------------------------------------------------
-- interview_turns — one row per question, answer, clarification, judge pass,
-- stage verdict or wrap-up.
--
-- `seq` is the transcript's own ordinal, assigned by the writer from the order
-- the engine emitted entries in. It is the primary ordering key and is what
-- makes the upsert idempotent: the browser sends the whole transcript on every
-- reply, and re-sending an entry that is already stored updates that row rather
-- than appending a duplicate.
--
-- The entry shape is deliberately loose. `kind` says what happened; `text` is
-- the prose; `detail` carries whatever that kind of entry needs (judge scores,
-- the clarification pair, a stage verdict). Prompts change the judge's output
-- over time, and a jsonb detail column absorbs that without a migration every
-- time a rubric does.
-- ---------------------------------------------------------------------------
create table if not exists public.interview_turns (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Ordinal within the interview, starting at 0.
  seq integer not null,
  kind text not null check (kind in ('question', 'answer', 'clarify', 'judge', 'stage_verdict')),
  -- Engine stage name: estimation | behavioral | product_design | ... Null for
  -- entries that are not tied to a stage.
  stage text,
  -- True for a follow-up question rather than one of the stage's own questions.
  is_follow_up boolean not null default false,
  -- The prose for this entry: the question text, the answer text, the
  -- interviewer's clarification answer, or a rendered verdict summary.
  text text not null default '',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Reads are always "this interview's turns in order", so the index is the
-- lookup. Unique, because that is what makes the upsert idempotent.
create unique index if not exists interview_turns_seq_uniq
  on public.interview_turns (interview_id, seq);

create index if not exists interview_turns_user_idx
  on public.interview_turns (user_id, created_at desc);

alter table public.interview_turns enable row level security;

drop policy if exists "turns are self-service" on public.interview_turns;
create policy "turns are self-service" on public.interview_turns
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- The running position of a live round, so "Resume this round" can reopen the
-- interview exactly where it stopped without asking the engine.
--
-- `interviews` keeps its summary columns; this holds the resume pointer: which
-- stage, which question, and how far through the transcript we are.
-- ---------------------------------------------------------------------------
create table if not exists public.interview_live_state (
  interview_id uuid primary key references public.interviews (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id text not null,
  -- Engine stage name and stage ordinal.
  stage text,
  stage_index integer not null default 0,
  -- The question the candidate was last asked and has not answered yet.
  pending_question text,
  pending_follow_up boolean not null default false,
  mode text,
  feedback_mode text,
  stage_progress jsonb not null default '{}'::jsonb,
  -- How many rows are in `interview_turns` for this interview when this row was
  -- written. Lets the client tell "nothing written yet" from "the transcript
  -- was never saved".
  turns_written integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists interview_live_state_user_idx
  on public.interview_live_state (user_id, updated_at desc);

alter table public.interview_live_state enable row level security;

drop policy if exists "live state is self-service" on public.interview_live_state;
create policy "live state is self-service" on public.interview_live_state
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists interview_live_state_touch_updated_at on public.interview_live_state;
create trigger interview_live_state_touch_updated_at
  before update on public.interview_live_state
  for each row execute function public.touch_updated_at();