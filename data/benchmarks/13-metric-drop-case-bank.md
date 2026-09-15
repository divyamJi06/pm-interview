# 13 — Metric-breakdown cases ("a metric dropped 80% — what do you do?")

- Fetched: 2026-09 (productmanagementexercises.com; IGotAnOffer)
  - **Role:** execution/metrics cases, reported at Netflix, Amazon, and 2+
    other companies.

## Real questions

- "A metric for a video streaming service dropped by 80%. What do you do?"
  (Netflix, Amazon) — the model execution case.
- "If the number of fake reviews decreases, what will be the impact?"
  (cause-and-effect reasoning; if good-for-fake-review-removal, why might a
  drop actually be bad?)
- "If a metrics question shows an unexplained drop, what's your investigation
  order?" — reports say interviewers look for: segment/dimension the drop →
  check instrumentation vs. actual behavior → cohort vs. calendar effects →
  root-cause hypothesis → experiment/guardrail plan.
- Metric definition drills ("what is the most important metric for Google
  Docs and why?", "define metrics for Netflix Podcasts").

## The recurring rubric (across Netflix/Amazon sources)

1. Clarify the metric and the business goal it serves.
2. Segment: user, cohort, device, geo, feature axis.
3. Validate the data before blaming a product change.
4. Propose a hypothesis + a reversible experiment.
5. Choose guardrails you will not let move.

## What this says about our mock

- We have no metric-breakdown question type; our case_study bank is
  product-strategy flavored. Adding 2-3 execution-case prompts ("a key metric
  dropped" / "fake reviews dropped — is that good?") gives real coverage,
  and the 5-step rubric fits our case_study dimension mode neatly.
- The "guardrail metric you won't move" concept ties directly to the Meta
  trade-off finding (`04`) — one shared rubric upgrade covers both.

## Sources

- https://www.productmanagementexercises.com/interview-questions
- https://igotanoffer.com/en/advice/product-manager-interview-process