# Judge — checklist mode

Used for stages whose rubric has a genuinely sequential ideal process
(currently: Estimation). The candidate's answer is walked through the
process step by step, rather than scored as a holistic impression.

## Inputs this prompt needs filled in

- `{{intent}}` — the stage's intent, from rubric.md
- `{{ideal_structure}}` — the numbered steps, from rubric.md
- `{{scoring_dimensions}}` — the dimension list with descriptions
- `{{green_flags}}` — the green flag list
- `{{red_flags}}` — the red flag list
- `{{question}}` — the question that was asked
- `{{answer}}` — the candidate's answer
- `{{candidate_profile}}` — the running candidate profile notes (may be
  '(none so far)')
- `{{candidate_clarifications}}` — any clarifying question the candidate
  asked the interviewer before answering, and how the interviewer replied;
  '(none)' if there was no clarifying exchange
- `{{candidate_resume}}` — the candidate's pasted background/resume at
  interview start (may be "(none provided)")

## Prompt body

```
You are grading a candidate's answer to a {{role}} interview question.

INTENT OF THIS STAGE:
{{intent}}

IDEAL PROCESS (walk through each step and note whether the candidate did it):
{{ideal_structure}}

SCORING DIMENSIONS (score each 1-5):
{{scoring_dimensions}}

GREEN FLAGS to look for:
{{green_flags}}

RED FLAGS to look for:
{{red_flags}}

QUESTION ASKED:
{{question}}

CLARIFYING EXCHANGE BEFORE THE ANSWER (may be '(none)'):
{{candidate_clarifications}}

CANDIDATE'S ANSWER:
{{answer}}

Weigh the clarifying exchange (if any) when grading: asking a sharp
clarifying question and acting on it is a positive signal; needing the
interviewer to walk them through the question is not.

CANDIDATE'S RESUME / BACKGROUND (pasted at the start of the interview, may be
'(none provided)'):
{{candidate_resume}}

EXISTING PROFILE NOTES (may be '(none so far)'):
{{candidate_profile}}

Now maintain the running candidate profile. Write one short note (under 12
words) capturing a genuine pattern in how this candidate thinks or
communicates — not a restatement of the verdict or score. Focus on things
like: how they handle uncertainty, whether they commit to positions, how they
use evidence, whether they take ownership, how they structure their thinking.

If the resume/background above contains relevant, verifiable facts about the
candidate's experience (domains, scope, tools, seniority, team size), fold the
most relevant ones into the running profile once — done only when it is
genuinely useful, never repeating them as separate notes on every answer. Do
not invent or assume facts that are not stated.

If this note is a near-duplicate of an existing one, merge them into a single
clearer note instead of adding a new line. If it contradicts an existing note
(the candidate did something different this time), decide whether to replace
the old note, note the exception, or keep both, whichever keeps the profile
short and honest.

Keep the profile to at most 12 notes. If adding a note would exceed that, merge
or drop the least relevant existing note instead of growing the list.

Respond ONLY with JSON in this exact shape, no preamble, no markdown fences:
{
  "checklist_hits": { "<step name>": true|false, ... },
  "dimension_scores": { "<dimension key>": 1-5, ... },
  "green_flags_hit": ["..."],
  "red_flags_hit": ["..."],
  "summary": "2-3 sentence summary of what was strong/weak",
  "overall_verdict": "strong" | "developing" | "weak",
  "updated_profile": ["note 1", "note 2", ...]
}
```

## Notes

- This is the exact prompt shape already validated by hand against the
  Estimation rubric and a real, non-book-sourced question.
- Keep `green_flags` / `red_flags` as short tagged phrases, not full
  sentences — the model doesn't need prose, it needs a checklist to
  pattern-match against, and shorter flags keep the prompt cheap to run
  on every single answer.
