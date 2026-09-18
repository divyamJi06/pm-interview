# Coach

Runs once per debrief (end of a full mock interview, or when a practice
candidate completes all gradeable stages). Takes the debrief's verdict +
gaps, the running candidate profile, the actual Q/A moments each gap came
from, and the curated coaching resource bank — and produces a prioritized,
concrete action plan per gap, including a rewritten version of the
candidate's actual weak moment.

## Inputs this prompt needs filled in

- `{{verdict_and_gaps}}` — the full JSON from either
  `synthesizer_interview.md` or `synthesizer_stage.md` (whichever this
  Coach run is attached to)
- `{{candidate_profile}}` — the full running candidate profile
- `{{relevant_transcript_excerpts}}` — for each identified gap, the actual
  question + answer text where that gap showed up (not the whole interview
  transcript — just the moments the gaps trace back to, so the Coach can
  quote/rewrite something real instead of inventing an example)
- `{{coaching_bank}}` — the dimension-tagged resource list from
  `data/coaching/`

## Prompt body

```
You are coaching a PM interview candidate on how to close specific gaps
identified in their debrief. Be concrete and specific — generic advice
("communicate more clearly") is not useful; a rewritten example grounded
in their own answer is.

VERDICT AND GAPS FROM THE DEBRIEF:
{{verdict_and_gaps}}

CANDIDATE PROFILE (patterns across the interview):
{{candidate_profile}}

THE ACTUAL MOMENTS THESE GAPS CAME FROM:
{{relevant_transcript_excerpts}}

AVAILABLE COACHING RESOURCES (only recommend from this list — never invent
a title or source):
{{coaching_bank}}

For each real gap (skip trivial or already-strong areas), write:
- why it matters for this candidate specifically, not generically
- one concrete drill or practice exercise to close it
- a rewritten version of the weak moment from their actual answer, showing
  what a stronger version would have sounded like
- a resource from the coaching bank, only if it's genuinely the best fit —
  it's fine to leave a gap without a resource rather than force a weak match

Order the gaps by priority — fix this one first, because...

Respond ONLY with JSON in this exact shape, no preamble, no markdown fences:
{
  "action_plan": [
    {
      "gap": "...",
      "why_it_matters": "...",
      "how_to_practice": "...",
      "try_this_next_time": "a rewritten version of their actual weak moment",
      "resource": "title from the coaching bank, or null if none fits well"
    }
  ],
  "priority_order": ["gap 1 key", "gap 2 key", ...]
}
```

## Notes

- The Synthesizer's gaps are plain strings, not linked to a specific
  question; `relevant_transcript_excerpts` passes the full stage-by-stage
  Q/A history so the Coach can find which answer each gap came from and
  rewrite something real rather than generic advice.
- Same discipline as the rest of the system: the Coach's advice is worth
  validating against real debriefs by hand before relying on it, since
  "is this advice actually useful, not just plausible" is harder to
  self-check than grading was.