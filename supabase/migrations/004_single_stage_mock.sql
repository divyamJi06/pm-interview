-- The multi-stage "full mock" walk is gone. Every round is now a single-stage
-- mock: one stage, judged, with feedback released at the end.
--
-- Existing rows are folded onto 'mock' before the constraint is tightened, so
-- this is safe to apply to a database that already holds practice rounds.

update public.interviews set mode = 'mock' where mode <> 'mock';

alter table public.interviews
  drop constraint if exists interviews_mode_check;

alter table public.interviews
  add constraint interviews_mode_check check (mode = 'mock');

alter table public.interviews
  alter column mode set default 'mock';

-- A round without a stage cannot be resumed, so it no longer accepts NULL.
update public.interviews set stage = 'behavioral' where stage is null or stage = '';

alter table public.interviews
  alter column stage set not null;

-- Feedback is no longer chosen per round: it is always withheld during the round
-- and revealed with the final report. Existing values are normalized to 'full'
-- so the historical rows stay readable.
update public.interviews set feedback_mode = 'full' where feedback_mode <> 'full';

alter table public.interviews
  drop constraint if exists interviews_feedback_mode_check;

alter table public.interviews
  add constraint interviews_feedback_mode_check check (feedback_mode = 'full');

alter table public.interviews
  alter column feedback_mode set default 'full';

-- The live-state pointer carried the same fields, kept in step with the above.
alter table public.interview_live_state
  drop constraint if exists interview_live_state_mode_check;

alter table public.interview_live_state
  drop column if exists mode;

alter table public.interview_live_state
  drop column if exists feedback_mode;