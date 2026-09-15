# Stage order and budgets

How a full mock interview is sequenced. This file is the single source of
truth for the interview structure — `server/config/stageOrder.js` parses
the table and decision lines below, so changes here take effect without
touching code.

| Order | Stage | Mode | Min questions | Notes |
|---|---|---|---|---|
| 1 | greeting | none | 2 | Tone-setting and light personalization only; ungraded, no rubric |
| 2 | behavioral | dimension | 2 | Follow-ups (if any) are decided by the Director, not a fixed budget |
| 3 | estimation | checklist | 1 | Scored step-by-step against the 8-step process |
| 4 | product_design | dimension | 2 | |
| 5 | case_study | dimension | 1 | Real case interviews are naturally a back-and-forth |
| 6 | strategy | dimension | 2 | Strategic, forward-looking, business-model questions ("If you were CEO...", "biggest threat to X") |
| 7 | execution_metrics | dimension | 2 | Metric definition, diagnosis, and growth: what to measure and why |
| 8 | technical | dimension | 1 | Technical-lite round: explain-the-system and trade-off questions (Uber/Google style) |

The "Min questions" column is a floor, not a ceiling: the Director keeps
asking main questions while time, signal, and the candidate's answers
warrant it, and only wraps a stage once the minimum has been asked. The
candidate can pause and ask a clarifying question at any point; whether to
keep answering clarifications (and when to tell the candidate to answer
now) is also decided dynamically, using how much has been clarified, how
much signal remains, and the time left.

Rough target: ~90 minutes total for the 8-stage loop. `time_budget_minutes`
is how the system turns "how long should this take" into a concrete pacing
signal for the Director.

## Decisions

- feedback_timing: stage_boundary
- time_budget_minutes: 90
- round_budget_minutes: 40
- clarify_cap_per_question: 3

## Why these decisions

- **feedback_timing = stage_boundary** — a real interviewer doesn't grade
  mid-answer, but an hour with zero signal is opaque. Revealing each
  stage's verdict (and only the verdict, not per-answer grading) when the
  stage ends is the middle ground. Per-answer Judge output is never shown
  in mock mode.
- **No fixed follow-up budgets** — a cap per stage (e.g. "2 follow-ups")
  rewards padding and punishes genuinely deep answers. Instead, the Director
  reads the just-graded answer's intent coverage and pacing and decides each
  time whether another follow-up is worth it: probe what the rubric cares
  about that's still weak, move on once the intent is captured. Follow-ups
  are the exception, not the rule — most answers in a real interview get
  none. The system guarantees termination with a per-stage turn ceiling and
  the time budget, not with a follow-up count.
- **Min questions are a floor, not a cap** — the stage column used to be a
  hard ceiling (the stage ended as soon as it was reached), which capped a
  40-minute behavioral round at two questions. Reinterpreting it as a floor
  lets the Director ask more main questions while time, turn budget, and
  signal allow, the way a real interviewer does. The stage still cannot wrap
  before the minimum main questions are asked; safety rails remain the
  per-stage turn ceiling and the time budget.
- **Clarifying questions are auto-detected** — every message the candidate
  types goes through a single input; a lightweight classifier decides
  whether it's an answer or a clarifying question, so there's no separate
  "clarify" button. The interviewer (per `director_clarify.md`) answers
  clarifications without leaking the rubric and decides when to wrap the
  candidate up. A wrap-up never happens on the very first clarifying
  question, and `clarify_cap_per_question = 3` bounds how many clarifiers
  one question can absorb before the interviewer insists on an answer.
- **round_budget_minutes = 40** — practice rounds each focus on a single
  stage and use a shorter clock, closer to a real 40-50 min interview slot,
  so the Director's pacing cues match real-world constraints rather than the
  full 90-minute mock budget.

To switch feedback timing to end-of-interview-only, change
`feedback_timing` to `end_of_interview`. To change the target interview
length, adjust `time_budget_minutes` or `round_budget_minutes`. The app
picks both up on the next interview.