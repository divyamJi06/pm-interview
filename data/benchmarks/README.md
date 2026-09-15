# Benchmarks: real PM interviews observed from the web

This directory stores real product-manager interview material gathered from
the web, so the mock interviews can be compared against what actual loops
look like and tuned to match. Each file is one company/round study or one
question bank, with the questions as reported by real candidates and the
source URLs.

Files are plain markdown on purpose, the same as the rest of `data/`.
`comparison.md` is the living analysis: our mock vs. the real world, and the
suggested changes, in priority order.

## Index

| # | File | Company / focus | Maps to our stage |
|---|---|---|---|
| 01 | `01-amazon-senior-pm-behavioral.md` | Amazon loop + Leadership Principles | behavioral, case_study |
| 02 | `02-google-l6-final-loop.md` | Google L6 final loop (behavioral / product design / analytics / strategy) | all stages |
| 03 | `03-google-onsite-candidate-account.md` | Google on-site day, real candidate report | process / pacing |
| 04 | `04-meta-product-sense-execution-leadership.md` | Meta 3-competency model | behavioral, product_design |
| 05 | `05-uber-product-sense-jam-technical.md` | Uber product sense + jam session + technical-lite | product_design, case_study |
| 06 | `06-netflix-hiring-manager-product-sense.md` | Netflix HM screen + product sense | behavioral, product_design |
| 07 | `07-apple-behavioral-and-metrics.md` | Apple behavioral + metrics | behavioral, estimation |
| 08 | `08-estimation-and-growth-case-bank.md` | Estimation + growth case bank (Gmail, UCS, TikTok...) | estimation |
| 09 | `09-behavioral-question-bank.md` | Cross-company behavioral bank (495+) | behavioral |
| 10 | `10-reforge-product-leader-questions.md` | Reforge VP/CPO-authored questions | behavioral, case_study |
| 11 | `11-community-pm-question-gist.md` | Community-collected PM question list | all stages |
| 12 | `12-microsoft-cmu-interview-approach.md` | Microsoft PM (CMU workshop) on approach | process / behavior |
| 13 | `13-metric-drop-case-bank.md` | Metric-breakdown cases (streaming -80%) | case_study, product_design |

## How to read an entry

Each entry has the same skeleton: source & role, the process, real questions
(full quotes where available), what interviewers evaluate, observed
follow-up/pushback behavior, what it says about our mock, and source URLs.

Content is a snapshot as of the fetch date in each file; web pages drift, so
URLs are the citation, not the source of truth.

## Where the questions went

The real questions were categorized into the existing stages and merged into
each stage's `data/stages/<stage>/questions.md` under a `## Real interview
questions` section (with per-question source notes). Questions that fit no
existing stage were seeded into three new stage folders (now wired into
`server/config/stage_order.md` with book-based rubrics in `rubric.md`):

- `data/stages/strategy/` — competitive/business strategy
- `data/stages/execution_metrics/` — metrics, growth, prioritization
- `data/stages/technical/` — system-design / technical-lite