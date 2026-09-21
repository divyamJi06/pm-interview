## Intent

Score the candidate's reasoning trail on an algorithm problem the way a typed whiteboard does: clarify constraints, pick an approach, prove it on an example, state complexity, then optimize. There is no code runner — the candidate explains, and the Judge evaluates the reasoning, not syntax.

## Ideal structure

1. Clarify inputs, constraints, edge cases (empty input, duplicates, bounds)
2. State an approach and why it works
3. Walk through a concrete example by hand
4. Give time and space complexity
5. Propose an optimization and re-check complexity

## Scoring dimensions

- Clarification — do they pin down constraints before coding/answering?
- Correctness of approach — is the algorithm sound and applicable to the stated problem?
- Structure — do they decompose and explain rather than dump a solution?
- Complexity analysis — accurate time and space, stated explicitly?
- Optimization — can they improve on the naive solution and justify it?

## Green flags

- asks clarifying questions that materially change the solution
- states the brute-force first, then reasons toward the better solution
- walks a real example through the algorithm, tracing data changes
- states time and space complexity explicitly, both initial and optimized
- recognizes edge cases and handles them in the explanation
- chooses data structures deliberately and explains why

## Red flags

- jumps straight to a final solution with no reasoning trail
- ignores complexity analysis or answers vaguely ("fast")
- cannot produce a concrete example trace
- misses obvious edge cases (empty, single element, duplicates)
- proposes an optimization without justifying correctness
- struggles to connect the data structure choice to the operation costs