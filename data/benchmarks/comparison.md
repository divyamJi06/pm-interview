# Comparison: our mock interviews vs. real PM interviews

This compares the mock interview system (see `README.md` at project root:
greeting → behavioral → estimation → product_design → case_study, four-role
loop, ~60 min, feedback at stage boundaries) against 13 benchmark studies in
this folder gathered from the web (Amazon, Google, Meta, Uber, Netflix,
Apple, Microsoft, Reforge, and cross-company banks).

## TL;DR

The mock's **architecture is already realistic** (a real PM loop is exactly a
sequence of distinct rounds with a human grading rubric). The gaps are in
**content breadth**, **follow-up intensity**, **company flavor**, and a few
**behavioral patterns** — most of which are *content/markdown edits*, not new
engineering.

## 1. How real PM loops actually look (from the studies)

- **Multiple rounds, one competency each.** Amazon: 5 x 55-min, each
  interviewer owns one Leadership Principle. Meta: 3 competencies (Product
  Sense / Execution / Leadership & Drive), one per interview. Google: 4-round
  final loop (behavioral / product design / analytics / strategy).
- **Rounds have distinct formats.** Recruiter chat → hiring-manager screen
  (~30-45 min, behavioral + mini case) → loop rounds → presentation/jam rounds
  (Uber jam session, take-home presented to the panel) → occasionally a
  technical/system round (Uber, Google PMT).
- **Behavioral is the most universal round** — Amazon/Meta/Netflix/Apple all
  weight it heavily; questions are ALL "tell me about a time...", answered in
  STAR/SPSIL, and always drilled with follow-ups ("what did YOU do?", "what
  were the numbers?", "what would you change?").
- **Product sense = design + measure.** Every company pairs the design prompt
  with metrics ("how would you measure success", "which metric do you accept
  declining?").
- **Strategy/execution rounds stress-test under pressure.** Google: heaviest
  follow-up pressure in strategy rounds. Uber: "if-then-what" chained
  follow-ups with injected constraints (fraud, latency). Netflix/Amazon:
  metric-breakdown cases ("a metric dropped 80% — what do you do?").
- **Interviewer behavior is deliberately human:** letting the candidate "take
  a moment to think", rewarding clarifying questions, probing risks/limitations,
  and judging candor over confidence.

## 2. Mapping: our mock vs. real

| Our mock | Real equivalent | Verdict |
|---|---|---|
| Greeting (2 ungraded turns) | Recruiter screen / warm-up ("tell me about yourself") | Closest gap: greeting never asks "why are you leaving / why this company" openers (Benchmarks 09, 10) |
| Behavioral (2 questions, dimension rubric) | Amazon LP / Meta Leadership / Google behavioral rounds | Structure matches; breadth tiny (5 questions vs 500+); missing highest-frequency types (failed product, difficult stakeholder, calculated risk, saying no) (09, 02, 04) |
| Estimation (1 question, 8-step checklist) | Google GCA / market sizing | Best-covered stage; our new questions validated as real (08, 11) |
| Product design (2 questions) | Meta Product Sense / Apple / Netflix prompts | Structure fine; prompts are generic products, not segment- or company-branded (Netflix "new grads finding shows", Apple "delete a product if you were CEO") (04, 06, 07) |
| Case study (1 question) | Execution/metrics + strategy cases | Closest is product-strategy; missing execution/metric-breakdown cases (metric dropped 80%) and forced trade-offs (06, 04, 13) |
| Director follow-ups | Real follow-up behavior | Already good (dynamic, builds on answer); missing *constraint-injection* and *story-drilling* types (05, 02, 10) |
| Judge / profile-writer notes | Interviewer's competency evaluation | Rubric aligns; missing explicit checks: "we vs I" ownership, stated trade-offs, risk/limitation disclosure (09, 12) |
| Feedback at stage boundaries | Real candidates get no live feedback | Deliberate product choice; fine |
| Single interviewer voice | Multiple interviewers of differing styles | Gap; candidates report wildly different styles sit-to-sit (03) |

## 3. The six gaps, by size

### Gap A — Question bank breadth (biggest, cheapest)
All banks are 5 questions; real interviews draw from hundreds.
- Behavioral is the worst: missing the top-frequency types (09): failed
  product, difficult stakeholder, calculated risk, making a mistake, short-term
  sacrifice for long-term gain, saying no to a request, "we vs I" ownership.
- Product design: mostly generic consumer products; add segment-specific and
  branded prompts (06, 07).
- Case study: add 2-3 execution/metric-breakdown prompts (13) rather than only
  strategy-flavored ones.
- Fix is pure markdown: no code changes.

### Gap B — Follow-up realism (biggest behavioral gap)
Real follow-ups *inject constraints* and *drill the story*; ours tend to ask
"go on". Two cheap Director upgrade patterns:
- Constraint injection: after a design/case answer, follow up with a
  constraint ("how do you prevent fraud in gift cards?", "the metric dropped
  80% — re-answer").
- Story drilling: after a behavioral answer, "what did YOU personally do vs
  the team?" / "what numbers moved?" / "what would you change?" (10, 13).

### Gap C — Company flavor
Real interviews are company-shaped (Amazon LPs, Meta's "say no", Uber's
marketplace north-star + data, Netflix candor/ownership). A **company preset**
(file `data/companies/<company>.md`: question pool, north star, emphasized
rubric dimensions, follow-up style) that the Director/Judge read would let one
mock simulate many companies with zero behavioral hard-coding.

### Gap D — Metrics & trade-off muscle
Every company forces metric discipline: choose a success metric, name a
guardrail you won't move, accept a declining metric. Our rubrics ask for
metrics implicitly; the *interviewer* should insist out loud more often and the
Judge should penalize metric-dumps (list of 8) in favor of 2-3 (08, 04, 13).

### Gap E — Behavioral expectations (candidate-side)
Real prep guidance says rewarded behaviors: ask to "take a moment to think"
out loud, state risks/limitations up front, go big/wide, candor over
confidence (12, 03). Add explicit green flags to rubrics; teach the mock to
acknowledge a "thinking pause" intent.

### Gap F — Optional realism (bigger engineering)
- Presentation/jam round (Uber take-home style) and a technical-lite round for
  companies that use them; multi-interviewer persona switching; Amazon-style
  written exercise. These are product bets, not correctness fixes — last in
  priority.

## 4. Suggested changes, in order

| # | Change | Where | Effort | Impact |
|---|---|---|---|---|
| 1 | Expand question banks (behavioral, product design, case study) from real lists in `09/06/07/13` | `data/stages/*/questions.md` | content only | High |
| 2 | Tag bank questions by company flavor (Amazon LP, Meta, Google) and pick banks by a chosen company | `data/stages/*/questions.md` + `server/config/stage_order.md` (optional `company` option) | content + small | High |
| 3 | Director follow-up patterns: constraint-injection + story-drilling | `prompts/director.md` instructions | prompt only | High |
| 4 | Judge: explicit trade-off / guardrail-metric check + "we vs I" ownership check + risk-limitation green flag | `data/stages/*/rubric.md` | content only | Medium |
| 5 | Greeting: add opener questions ("why this company / why changing now") | `data/stages/greeting/questions.md` | content only | Medium |
| 6 | Company presets (`data/companies/*.md`) consumed by Director/Judge for north star + emphasis | `data/companies/` + `server/lib/interview.js` | medium | High |
| 7 | Execution/metrics stage (Google/Meta/Uber style) | `data/stages/execution_metrics/` + `stage_order.md` + rubric | content only | Medium |
| 8 | Optional jam/presentation rounds + multi-interviewer personas | code | large | Low-Medium |

Priorities 1-5 require **no code changes** (markdown + prompt edits only) and
are safe to do next. Items 7's stage — and the Strategy and Technical-lite
stages from row 8 — have shipped: all three are in `server/config/stage_order.md`
with book-based rubrics. Remaining from 6-8: company presets and the
jam/presentation round.

## 5. Validated alignment (things we already get right)

- Estimation stage duplicates the real 8-step expectation and, after the recent
  additions, draws from questions real candidates report (11).
- Dimension-based behavioral rubric already contains the "we vs I" ownership
  red flag and reflection/scoring that real interviews check (09, 10).
- Dynamic, non-budgeted follow-ups (Director) match the observation that real
  interviewers follow signal, not quotas (02, 05).
- Full-mock stage sequence (behavioral → estimation → product design → case
  study) covers the rounds that dominate real loops; feedback withheld to
  stage boundaries is the one deliberate deviation (and a good one).

## 6. Open questions before implementing

1. Do you want a **company preset** feature (pick "Amazon mode" / "Google
   mode" at setup), or stay company-neutral but richer? (affects #2 and #6)
2. Should the optional execution/metrics stage be added to the full-mock
   sequence (making it ~70-80 min), or stay practice-mode-only?
3. Are the prompt-only changes (#3 Director follow-up patterns) OK to ship
   without new tests, or should they come with a director-scenario test
   (per README next-steps item 3)?