## Intent

Measure whether the candidate reasons correctly under distributed systems reality: partial failure, no shared clock, and no globally consistent view. Correct trade-off language about consistency, availability, and failure handling matters more than reciting textbook mechanisms.

## Ideal structure

1. Identify the distributed property at stake (consistency, ordering, liveness)
2. State the trade-off explicitly (e.g., CAP, queuing theory, limits for locks)
3. Design the mechanism and its failure modes
4. Explain empirical behavior: what happens in a partition or leader loss
5. Justify the operational consequence and fallbacks

## Scoring dimensions

- Problem identification — do they name the core distributed property?
- Trade-off awareness — do they articulate consistency/availability/latency tension?
- Mechanism design — is the proposed mechanism correct under failure?
- Failure reasoning — do they cover leader loss, partitions, retries, timeouts?
- Operational judgment — realistic consequences and backoff/fallback plans?

## Green flags

- talks about partial failure before designing anything
- names the consistency trade-off explicitly and where it bites
- designs idempotency / retry budgets / backoff for at-least-once paths
- describes behavior during a partition rather than pretending it can't happen
- reasons about timeouts, deadline propagation, and cascading failure
- gives a sane fallback when the ideal mechanism is impractical

## Red flags

- assumes a distributed system behaves like a single machine
- proposes a lock or counter with no failure mode analysis
- says "exactly-once" without mentioning idempotency or dedup state
- ignores retries, timeouts, or unbounded retry with load
- hand-waves CAP with no application to their own claims
- designs for happy path only and gets stuck when probed on failure