## Intent

Score the candidate's debugging discipline: symptoms before theories, a narrowing search based on evidence, and a fix that is verified. The answer is a process, and interviewers want to see the candidate build and test hypotheses rather than guess at a root cause.

## Ideal structure

1. Reproduce or scope the symptom (who, when, how often)
2. Form hypotheses ranked by likelihood
3. Gather evidence to confirm or kill each hypothesis (logs, metrics, traces)
4. Isolate the root cause
5. Fix it, verify it, and prevent recurrence

## Scoring dimensions

- Symptom clarity — do they nail down the actual symptom and scope first?
- Evidence discipline — do they seek data before jumping to fixes?
- Hypothesis ranking — do they test plausible causes efficiently?
- Narrowing — do they bisect the search space instead of guessing?
- Closure — verified fix plus prevention of recurrence?

## Green flags

- asks what changed recently (deploy, config, dependency, traffic)
- uses metrics/logs to test hypotheses rather than guessing
- narrows the search space systematically (by time, region, version)
- isolates variables instead of changing several things at once
- verifies the fix and considers whether it recurs elsewhere

## Red flags

- declares a root cause from the first hypothesis with no evidence
- changes multiple things at once and calls it a fix
- ignores the "what changed" signal that most incidents carry
- stops at mitigation without finding root cause
- cannot say how they would verify the fix
- blames infrastructure vaguely ("probably the DB") with no data