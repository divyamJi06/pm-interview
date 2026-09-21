# Stage order and budgets — Software Engineering track

How a full engineering mock interview is sequenced. Parsed by
`server/config/stageOrder.js` — changes here take effect without touching
code.

| Order | Stage | Mode | Min questions | Notes |
|---|---|---|---|---|
| 1 | greeting | none | 2 | Tone-setting and light personalization only; ungraded, no rubric |
| 2 | behavioral | dimension | 3 | Bar-raising behavioral: ownership, conflict, trade-offs, pushback |
| 3 | algorithms | dimension | 2 | Like a typed whiteboard: full approach, complexity, then optimize |
| 4 | system_design | dimension | 2 | Design a subsystem end-to-end; scale and trade-offs matter |
| 5 | debugging | dimension | 2 | Root-cause reasoning from symptoms, logs, or a broken flow |
| 6 | distributed_systems | dimension | 2 | Consistency, latency, failure modes, and operational trade-offs |

"Min questions" is a floor, not a ceiling: the Director keeps asking while
time, signal, and the candidate's answers warrant it, and only wraps a stage
once the minimum has been asked. Candidates can pause and ask a clarifying
question at any point; whether to keep answering (and when to say "answer
now") is also decided dynamically.

Rough target: ~90 minutes total for the 6-stage loop via
`time_budget_minutes`; practice rounds use `round_budget_minutes`.

## Decisions

- feedback_timing: stage_boundary
- time_budget_minutes: 90
- round_budget_minutes: 40
- clarify_cap_per_question: 3

## Why these decisions

- **feedback_timing = stage_boundary** — a real interviewer doesn't grade
  mid-answer, but a long loop with zero signal is opaque. Revealing each
  stage's verdict at the stage boundary is the middle ground.
- **Algorithms by typed prose, not an executor** — candidates explain the
  full approach, walk through an example, give time/space complexity, then
  state the optimization. There is no code runner; the Judge scores the
  reasoning trail, not syntax.
- **Debugging and incidents are answerable in prose** — symptoms + logs +
  a candidate's line of reasoning produce a gradeable root-cause walk.
- **Min questions are a floor, not a cap** — the Director reads intent
  coverage and pacing each time and decides whether another main question
  or follow-up is worth it.
- **round_budget_minutes = 40** — practice rounds use a shorter clock,
  closer to a real 40-50 min interview slot.

To change the target length, adjust `time_budget_minutes` /
`round_budget_minutes`. The app picks both up on the next interview.