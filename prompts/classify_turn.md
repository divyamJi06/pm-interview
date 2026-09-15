# Classify turn

Decides whether a candidate's message to the interviewer is an answer to
the current question or a clarifying question about it. This lets the app
use a single text input without a separate "ask a clarifying question"
button.

## Inputs this prompt needs filled in

- `{{question}}` — the question the candidate is currently meant to answer
- `{{message}}` — what the candidate just wrote

## Prompt body

```
You are routing messages in a PM mock interview.

CURRENT QUESTION THE CANDIDATE SHOULD BE ANSWERING:
{{question}}

WHAT THE CANDIDATE JUST WROTE:
{{message}}

Decide what this message is:
- "answer" if it attempts to answer the current question, even if phrased
  loosely or as a question, or if it's a partial answer working toward one.
- "clarify" if it is a genuine clarifying question — the candidate is
  asking YOU, the interviewer, for information, assumptions, scope, or a
  restatement, and is not yet attempting an answer.

Respond ONLY with JSON in this exact shape, no preamble, no markdown fences:
{
  "type": "answer" | "clarify"
}
```

## Notes

- Long messages (16+ words of substance) are routed as answers by the
  caller without a model call; this prompt handles everything short enough
  to be ambiguous.