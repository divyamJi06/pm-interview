# Profile-writer

Runs after every graded answer. Writes one short, plain-language note
about how the candidate thinks — not a re-statement of the score — and
either adds it to the running candidate profile or merges it with an
existing similar note, so the profile stays a short list of real patterns
rather than growing forever.

## Inputs this prompt needs filled in

- `{{question}}` — the question that was asked
- `{{answer}}` — the candidate's answer
- `{{judge_output}}` — the full JSON from the Judge for this answer
- `{{existing_profile}}` — the current list of notes (may be empty)
- `{{candidate_resume}}` — the candidate's pasted background/resume at
  interview start (may be "(none provided)")

## Prompt body

```
You are maintaining a short running profile of a PM interview candidate's
thinking style, based on their answers so far.

QUESTION ASKED:
{{question}}

CANDIDATE'S ANSWER:
{{answer}}

HOW IT WAS GRADED:
{{judge_output}}

CANDIDATE'S RESUME / BACKGROUND (pasted at the start of the interview):
{{candidate_resume}}

EXISTING PROFILE NOTES:
{{existing_profile}}

Write one short note (under 12 words) capturing a genuine pattern in how
this candidate thinks or communicates — not a restatement of the verdict
or score. Focus on things like: how they handle uncertainty, whether they
commit to positions, how they use evidence, whether they take ownership,
how they structure their thinking.

If the resume/background above contains relevant, verifiable facts about
the candidate's experience (domains, scope, tools, seniority, team size),
fold the most relevant ones into the running profile once — done only when
it is genuinely useful, never repeating them as separate notes on every
answer. Do not invent or assume facts that are not stated.

If this note is a near-duplicate of an existing one, merge them into a
single clearer note instead of adding a new line. If it contradicts an
existing note (the candidate did something different this time), decide
whether to replace the old note, note the exception, or keep both,
whichever keeps the profile short and honest.

Keep the profile to at most 12 notes. If adding a note would exceed that,
merge or drop the least relevant existing note instead of growing the
list.

Respond ONLY with JSON in this exact shape, no preamble, no markdown fences:
{
  "updated_profile": ["note 1", "note 2", ...]
}
```

## Notes

- This is the mechanism that lets an Estimation answer inform a later
  Behavioral follow-up — the Director reads `updated_profile`, not the raw
  answer history.
- The merge/replace instruction exists specifically to stop the profile
  from growing unbounded over a long interview and dominating every later
  prompt with noise. Worth testing this behavior specifically once this
  prompt is live — feed it a few answers that should merge and check it
  actually does.
