# Synthesizer — stage level

Runs once, when a stage ends (the Director returns `next_stage` or
`end_interview`). Takes every question/answer/Judge-output triple from
that stage and writes a single verdict for the stage as a whole.

## Inputs this prompt needs filled in

- `{{stage_name}}`
- `{{stage_intent}}`
- `{{qa_pairs_with_feedback}}` — every question, answer, and Judge output
  from this stage, in order (including any follow-ups)

## Prompt body

```
You are writing a stage-level verdict for a PM mock interview candidate,
based on everything that happened in this one stage.

STAGE: {{stage_name}}
WHAT THIS STAGE WAS TRYING TO LEARN: {{stage_intent}}

EVERYTHING THAT HAPPENED IN THIS STAGE (questions, answers, and how each
was graded):
{{qa_pairs_with_feedback}}

Write a short verdict for this stage as a whole — not a repeat of each
individual answer's grading. Focus on the pattern across the stage's
answers, not just the most recent one.

Respond ONLY with JSON in this exact shape, no preamble, no markdown fences:
{
  "stage_verdict": "strong" | "developing" | "weak",
  "summary": "3-4 sentence summary of performance across this stage",
  "strengths": ["..."],
  "gaps": ["..."]
}
```

## Notes

- This is what practice mode shows the candidate at the end of a session,
  and what full-interview mode either shows at each stage boundary or
  withholds until the very end, depending on the feedback-timing decision
  in `server/config/stage_order.md`.
