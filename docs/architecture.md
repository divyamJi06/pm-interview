# Architecture

## The four roles

This system is not one large agent — it's four small, single-purpose
prompts that hand off to each other in a loop. Each one is independently
testable, which is the whole point: a bug in one role shouldn't require
re-validating the other three.

| Role | Reads | Writes | Prompt file |
|---|---|---|---|---|
| Judge | rubric, question, answer, (optionally candidate profile) | a grading JSON for one answer | prompts/judge_checklist.md or prompts/judge_dimension.md |
| Profile-writer | question, answer, Judge's output, existing profile | one new/merged note in the running profile | prompts/profile_writer.md |
| Director | stage intent, progress/budget, last Judge output, candidate profile | one decision: follow_up / next_question / next_stage / end_interview | prompts/director.md |
| Synthesizer (stage) | every Q/A/feedback triple in a finished stage | one verdict for that stage | prompts/synthesizer_stage.md |
| Synthesizer (interview) | every stage verdict, full candidate profile | one overall verdict | prompts/synthesizer_interview.md |
| Coach | the debrief output, full candidate profile, the Q/A moments gaps came from, coaching resource bank | a prioritized action plan per gap with a rewritten weak moment | prompts/coach.md |

## The loop, one turn at a time

1. Candidate answers the current question (or follow-up).
2. **Judge** grades that single answer against the current stage's rubric.
3. **Profile-writer** appends or merges one note into the running candidate
   profile, based on the answer and how it was graded.
4. **Director** looks at the graded answer, the updated profile, and how
   much of the stage's question/follow-up budget remains, and decides:
   ask a follow-up, ask the next question, move to the next stage, or end
   the interview.
5. If the Director said `next_stage` or `end_interview`, the relevant
   **Synthesizer** runs once before moving on.
6. Loop back to step 1 with whatever the Director decided.

## Why a shared candidate profile, not just per-answer grading

Without it, every Judge call is stateless and isolated — an Estimation
answer's insight into how the candidate thinks under uncertainty would
have no way of reaching a later Behavioral follow-up. The profile is a
small, growing, plain-language scratchpad (not scores) that both the Judge
and the Director read, which is what makes the system feel like it's
building an understanding of the candidate over the whole interview,
rather than grading each answer in a vacuum.

## Why this is riskier to test than a plain Judge call

Everything up to the Director is stateless: one input, one expected
output, easy to validate with a golden set (see tests/golden-sets/). The
Director is not — the same answer can lead to a different decision
depending on what happened earlier in the interview. That's why
tests/director-scenarios/ exists as its own thing: synthetic snapshots of
"here's the state of the world, here's the expected decision," tested the
same way the Judge was, before the Director is ever wired into a live,
turn-by-turn flow.

## Practice mode vs. full mock interview

Both modes use the exact same five prompts. The only difference is
timing:
- **Practice mode** shows the Judge's feedback (and, at the end, the stage
  Synthesizer's verdict) after every single answer.
- **Full mock interview** withholds feedback — either until each stage
  ends, or until the whole interview ends, depending on the decision in
  server/config/stage_order.md — because a real interviewer doesn't grade
  you mid-answer.

Practice mode also typically runs only one stage and skips the
interview-level Synthesizer, since there's nothing to roll up across
stages when there's only one.

## The Coach, and when it runs

The Coach is the sixth role, and it is deliberately not part of the
per-turn loop. In a full mock interview it runs **once**, right after the
interview-level Synthesizer at the end of the interview. In practice mode
it runs **twice at the end of a round**: once at round level (right after
the stage Synthesizer, grounded in that stage's verdict and Q/A transcript
— shown as "How to improve this round" in the UI), and, when all gradeable
stages are covered and the automatic debrief fires, once more at
candidate level (grounded in the full accumulated Q/A history). It reads
the debrief's verdict and gaps, the candidate profile, the actual Q/A
transcript moments each gap traces back to, and the curated coaching
bank, and writes a prioritized `action_plan` plus `priority_order`. The
result rides along on the same final-report response (`action_plan` /
`priority_order` next to `stageVerdicts`) and is snapshotted with the
session or candidate debrief so it survives a resume and shows up in
Review.
