## Intent

Assess the candidate's command of product and business metrics: choosing the
ones that matter for a product or decision, defining them precisely, measuring
them soundly, and using them to diagnose an issue or justify a call. In
interviews, metric discussions typically ask the candidate to pick the right
metrics, define what is being counted, explain why a number moved, or validate
a decision.

## Ideal structure

1. State the goal the metrics must serve — the decision they will inform or
   the issue they must diagnose
2. Identify the relevant metric families — user acquisition, activity,
   conversion & retention, and money — and single out the ones that matter for
   this product at this point
3. Define each metric precisely: what counts, the time window, how an "active
   user" is defined
4. Measure the change in a metric over time, broken down by cohorts (e.g.
   location, device, date registered), rather than relying on total volume
   since the beginning of time, which is not actionable
5. Diagnose a movement methodically: is the observation real, which segment is
   responsible, what would explain it
6. Choose an appropriate way to gather data — usability testing and customer
   feedback for the "why", traffic analysis and internal logs for behavior, A/B
   testing to attribute an effect — and flag where a chosen method could
   mislead
7. Tie the metrics back to the decision or recommendation they support

## Scoring dimensions

- Metric selection — picks decisive metrics for the goal instead of dumping a
  list
- Precision of definition — defines what is being counted and over what window
- Measurement discipline — measures change and cohorts, not cumulative totals
- Diagnosis — reasons methodically about why a metric moved
- Method judgment — knows which data-gathering tools fit and where they fail
- Decision linkage — connects the metrics to the product or business decision

## Green flags

- singles out the metric family that fits the goal (acquisition, activity,
  conversion & retention, money)
- defines what counts: what an active user is, what a conversion means
- with insight, names the metrics the product will excel at and the ones it
  will struggle with
- measures change over time and breaks numbers down by cohorts
- probes a drop by segmenting and validating before acting
- reaches for the right tool: usability testing or feedback for context, logs
  and traffic analysis for depth, A/B testing to attribute a change
- flags A/B misuse — e.g. rolling a network-effect feature out to a small slice
  of users and misreading the result
- ties every metric back to the decision it should inform

## Red flags

- lists many metrics without choosing which ones matter
- leads with vanity numbers (total sign-ups since launch) as the main signal
- fixates on acquisition and ignores conversion and retention
- proposes A/B tests without considering rollout or network effects
- answers a "why did the metric drop" question with no diagnosis path
- never says what the metric should inform or what decision it protects

## Based on

Original distillation of _Cracking the PM Interview_ (McDowell), Ch. 15 —
"Product Metrics" (types of metrics, measuring, gathering data).