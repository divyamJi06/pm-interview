# Director test scenarios

The Director (prompts/director.md) is path-dependent — it can't be tested
with simple input/output pairs the way the Judge was, since its decision
depends on accumulated state (profile, budget used so far). Instead, each
scenario here is a synthetic snapshot of "here's the state of the world
right now" plus what decision you'd expect, so the Director's prompt can
be validated by hand before it's wired into a live loop.

## Format

Each scenario needs:
- A made-up stage, progress-so-far, last Judge output, and candidate
  profile (you don't need a real interview to have happened — write
  plausible fake data)
- Your own expected decision, with a one-line reason

## Example scenario

**Setup:**
- Stage: behavioral, questions asked: 1/2, follow-ups asked on this
  question so far: 0, clarifying questions asked this stage: 0, time
  remaining: plenty (budget 60 minutes, 8 in)
- Last Judge output: `overall_verdict: "developing"`, notes the candidate
  described the situation well but was vague about their personal role
  ("we decided", no individual actions named) — intent coverage low
- Candidate profile so far: empty (this is the first stage)

**Your expected decision:** `follow_up` — asking directly "what specifically
did you personally do in that situation" would resolve exactly the
ambiguity the Judge flagged, and there is no fixed follow-up cap; the
Director should probe depth while time remains.

**Model's actual decision:** _(fill in after running)_

---

## Scenarios still needed

- A case where the candidate just gave a long, yes-style answer to a
  follow-up that added no new information — the Director should see
  "last answer was a follow-up" + per-question follow-up count and stop
  drilling, moving on even though a follow-up *could* help, because
  deeper answers reached diminishing returns
- A case where the per-question follow-up count is already high (e.g. 3+)
  — check whether the Director treats "follow-ups asked on this question
  so far" as a reason to move on rather than piling on
- A case where time is nearly exhausted (elapsed close to
  `time_budget_minutes`) — the Director should prefer wrapping the stage
  even if the last answer was weak, since the interview must still finish
- A case where this is the last question of the last stage — confirm the
  Director returns `end_interview`, not `next_stage`
