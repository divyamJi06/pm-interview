# Judge — dimension mode

Used for stages whose rubric describes a set of qualities to look for
throughout a more freeform answer, rather than a strict sequence
(currently: Behavioral, Product Design, Case Study). The candidate's
answer is scored holistically against each dimension instead of being
walked through as a checklist.

## Inputs this prompt needs filled in

- `{{intent}}` — the stage's intent, from rubric.md
- `{{ideal_structure}}` — the stage's structure, from rubric.md (used here
  as a mental model for what a complete answer touches on, not as a
  literal step-by-step to verify — that's the difference from
  judge_checklist.md)
- `{{scoring_dimensions}}` — the dimension list with descriptions
- `{{green_flags}}` — the green flag list
- `{{red_flags}}` — the red flag list
- `{{question}}` — the question that was asked
- `{{answer}}` — the candidate's answer
- `{{candidate_profile}}` — (optional) the running candidate profile notes
  so far, if this stage comes later in a full interview — lets the Judge
  read an answer in light of established patterns rather than in
  isolation
- `{{candidate_clarifications}}` — any clarifying question the candidate
  asked the interviewer before answering, and how the interviewer replied;
  '(none)' if there was no clarifying exchange

## Prompt body

```
You are grading a candidate's answer to a PM interview question.

INTENT OF THIS STAGE:
{{intent}}

WHAT A COMPLETE ANSWER TYPICALLY COVERS (a mental model, not a rigid checklist):
{{ideal_structure}}

SCORING DIMENSIONS (score each 1-5, holistically):
{{scoring_dimensions}}

GREEN FLAGS to look for:
{{green_flags}}

RED FLAGS to look for:
{{red_flags}}

WHAT'S KNOWN ABOUT THIS CANDIDATE SO FAR (may be empty):
{{candidate_profile}}

QUESTION ASKED:
{{question}}

CLARIFYING EXCHANGE BEFORE THE ANSWER (may be '(none)'):
{{candidate_clarifications}}

CANDIDATE'S ANSWER:
{{answer}}

Weigh the clarifying exchange (if any) when grading: asking a sharp
clarifying question and acting on it is a positive signal; needing the
interviewer to walk them through the question is not.

Respond ONLY with JSON in this exact shape, no preamble, no markdown fences:
{
  "dimension_scores": { "<dimension key>": 1-5, ... },
  "green_flags_hit": ["..."],
  "red_flags_hit": ["..."],
  "summary": "2-3 sentence summary of what was strong/weak",
  "overall_verdict": "strong" | "developing" | "weak"
}
```

## Notes

- No `checklist_hits` field here — dimension-mode stages don't get graded
  step by step, so forcing that field would produce noise.
- The `candidate_profile` input is what makes this Judge call
  context-aware across stages. It's optional so the same prompt still
  works standalone in practice mode, where there's no profile yet.
