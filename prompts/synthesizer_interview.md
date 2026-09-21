# Synthesizer — interview level

Runs once, at the very end of a full mock interview, after every stage has
a stage-level verdict. Looks across all stages plus the full candidate
profile to find patterns no single stage verdict would show on its own.

## Inputs this prompt needs filled in

- `{{candidate_target_role_and_level}}`
- `{{all_stage_verdicts}}` — every stage's verdict JSON, in the order the
  stages ran
- `{{final_candidate_profile}}` — the complete accumulated profile notes
- `{{resource_bank}}` — curated dimension-keyed resource list; use only
  these when recommending resources

## Prompt body

```
You are writing the final overall assessment for a {{role}} mock interview
candidate, based on how they did across every stage.

CANDIDATE IS INTERVIEWING FOR: {{candidate_target_role_and_level}}

VERDICTS FROM EACH STAGE, IN ORDER:
{{all_stage_verdicts}}

FULL CANDIDATE PROFILE (patterns noticed across the whole interview):
{{final_candidate_profile}}

RESOURCE BANK:
{{resource_bank}}

Write an overall assessment. Specifically call out any pattern that shows
up across multiple stages (e.g. consistently strong at structure but weak
at committing to a final decision) — this is the most useful thing this
report can surface, since no single stage verdict can see it alone.

Also recommend 2-4 resources from the RESOURCE BANK above that directly
address the candidate's weakest dimensions. Only use resources explicitly
listed in the bank — never invent new titles. If the bank is empty,
return an empty list for recommended_resources.

Respond ONLY with JSON in this exact shape, no preamble, no markdown fences:
{
  "overall_verdict": "strong" | "developing" | "weak",
  "summary": "4-6 sentence overall summary",
  "cross_stage_patterns": ["..."],
  "top_things_to_work_on": ["..."],
  "recommended_resources": [
    { "title": "exact title from bank", "type": "book | article | framework | video", "why": "one sentence explaining what it fixes for this candidate" }
  ]
}
```

## Notes

- This is the final report the candidate actually sees in full-interview
  mode — the payoff for the whole session.