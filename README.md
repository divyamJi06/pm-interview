# PM interview prep

## What this is

A tool that turns *Cracking the PM Interview* into a structured practice and
mock-interview system for product manager interview prep.

Important: this project does not store or reproduce the book. The book was
read once, by hand, and distilled into original, structured rubrics —
`intent`, `ideal_structure`, `scoring_dimensions`, `green_flags`,
`red_flags` — that an AI Judge uses to grade a candidate's spoken/typed
answers. The book is research input, not a live knowledge base.

## How it's meant to work (end state)

Four small, specialized AI roles hand off to each other in a loop, instead
of one large agent trying to do everything at once:

- **Judge** — grades a single answer against the current stage's rubric.
  Runs in one of two modes: `checklist` (walks a sequential process step by
  step — e.g. Estimation) or `dimension` (scores a set of qualities
  holistically — e.g. Behavioral, Product Design, Case Study).
- **Director** — after every graded answer, decides what happens next: ask
  a follow-up, ask the next question, move to the next stage, or end the
  interview. Follow-ups are decided dynamically from grading depth, intent
  coverage, per-question follow-up count, time remaining, and the
  candidate profile (below) — there are no hard-coded follow-up budgets.
- **Profile-writer** — after every graded answer, writes one short,
  plain-language note about *how the candidate thinks*, not just how they
  scored. These notes accumulate across the whole interview, so something
  noticed in one stage (e.g. "hedges under uncertainty" in Estimation) can
  shape a follow-up in a later stage (e.g. Behavioral).
- **Synthesizer** — runs twice: once at the end of each stage (rolls up
  that stage's graded answers into a verdict), and once at the end of the
  full interview (rolls up all stage verdicts plus the full candidate
  profile into an overall assessment).

## Two modes, one system

- **Practice rounds** — one stage per round, on a ~40-minute round clock
  (`round_budget_minutes`). Every practice session belongs to a candidate
  (`candidates/`): the profile written during a round carries into the next
  round of the same candidate, so the interviewer probes with real context.
  Each round ends with that stage's verdict; once all gradeable stages are
  covered, the system auto-runs the debrief synthesizer and produces an
  overall verdict, cross-stage patterns, and recommended resources. A round
  plays in **Learn** mode (feedback after every answer) or **Simulation**
  mode (feedback withheld until the round ends, like a real round).
- **Full mock interview** — greeting → behavioral → estimation → product
  design → case study → strategy → execution metrics → technical, roughly
  90 minutes (`time_budget_minutes`), feedback withheld until a stage (or
  the whole interview) ends — closer to how a real interview feels.

Both modes reuse the exact same Judge, Director, Profile-writer, and
Synthesizer — practice rounds just run one stage on a shorter clock, with
feedback timing chosen by you.

## Current status

- Rubrics finished: Behavioral, Estimation, Product Design, Case Study (all
  from _Cracking the PM Interview_ principles), plus Strategy,
  Execution/Metrics, and Technical — rubric content sourced only from the
  book (Ch. 15 and Ch. 16)
- All eight stages are wired in `server/config/stage_order.md` — the full
  mock runs greeting → behavioral → estimation → product_design →
  case_study → strategy → execution_metrics → technical
- The Judge prompt has been manually validated against a real,
  non-book-sourced estimation question and both a strong and a weak sample
  answer — it cleanly told them apart
- **The full app is now implemented:** a plain-Node server
  (`server/server.js`), the four-role loop (`server/lib/interview.js`),
  in-memory sessions, and a single-page frontend (`public/index.html`).
  Practice rounds and full mock interview both work. Decisions in
  `server/config/stage_order.md` are made (feedback revealed at stage
  boundaries; a 90-minute mock budget and a 40-minute round budget) and are
  enforced by the app.
  Clarifying questions are auto-detected in a single input and answered
  by the interviewer; follow-ups are the Director's call, bounded by a
  10-turn-per-stage safety rail instead of a fixed budget.
- Practice mode is a **rounds** flow: a candidate is created once (target
  role + resume, capped at 8,000 characters) and candidates persist to
  `candidates/`. Each round plays one stage; the profile-writer's notes
  accumulate on the candidate and are fed back into later rounds'
  Directors, Judges, and clarifiers. Rounds end with the stage verdict
  (Learn feedback per answer, or Simulation with feedback withheld), and
  completing all gradeable stages auto-runs the debrief synthesizer for an
  overall verdict. Candidate coverage and debriefs are browsable in the
  setup card before starting a round.
- No database. Data lives in `data/` as plain markdown; session state
  lives in memory in a single process, and is snapshotted to `sessions/`
  after every turn so an interrupted or partially-finished interview
  survives a server restart and can be resumed from the UI. See below.
- Transient provider errors (rate limits `429`, `5xx`, network blips) are
  retried automatically with backoff (3 attempts) by `callModel.js`. If a
  turn still fails, the error message tells you your answer was not lost —
  the session state is only advanced once a turn fully completes, so
  resending the same answer is always safe.
- Reasoning models (e.g. Cohere `command-a-plus-05-2026`) get a bounded
  `thinking` token budget so their internal reasoning can never consume
  the whole output window and starve the actual JSON answer; the Judge,
  profile-writer, and synthesizers additionally get a larger output budget
  because they embed the full candidate answer.
- The final report ends with 2-4 recommended resources from a curated,
  dimension-tagged coaching bank in `data/coaching/` (edit the markdown
  files there to change what can be recommended). The synthesizer is told
  to only ever pick from that list — it never invents titles.
- At setup you can optionally paste your resume / background; it is held
  per session (capped at 8,000 characters) and fed to the profile-writer,
  which folds relevant facts into the running candidate profile so later
  stages judge with real context about the interviewee.

## Running it

The app auto-loads a `.env` file from the project root on startup (copy
`.env.example` and fill in the key for your provider):

```sh
# .env
AI_PROVIDER=cohere            # default is cohere anyway
COHERE_API_KEY=your-key-here
```

```sh
npm start                     # http://127.0.0.1:3000
```

Pick a provider with `AI_PROVIDER` and set its key and (optionally) model
(in `.env` or exported env vars):

| Provider | `AI_PROVIDER` | API key env | Model env | Default model |
|---|---|---|---|---|
| Cohere | `cohere` | `COHERE_API_KEY` | `COHERE_MODEL` | `command-a-plus-05-2026` |
| OpenAI | `openai` | `OPENAI_API_KEY` | `OPENAI_MODEL` | `gpt-4.1-mini` |
| Groq | `groq` | `GROQ_API_KEY` | `GROQ_MODEL` | `llama-3.3-70b-versatile` |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` | `claude-sonnet-5` |

`AI_MODEL` overrides whichever default would otherwise be used. Every
provider gets the exact same prompt and expects the same strict-JSON
shape back; only the transport differs. Without any key the server still
boots and explains exactly which one is missing.

Attempted provider calls can leave the JSON wrapped in code fences; the
parsing layer strips them before parsing, so this works across providers.

Tests run offline with a scripted fake model — no key needed:

```sh
npm test
```

## Cost & traces

Every model call (successful or not) is written to disk per session, so
you can audit exactly what was sent, what came back, and what it cost:

```
traces/<session-id>/
  info.json                 session metadata (mode, stage, start time)
  calls/<NNN>-<role>-<stage>.json
                            one file per model call: the prompt sent
                            (input), raw + parsed output, token usage,
                            cost, duration, success/error
  cost-summary.json         totals per session: call counts, tokens,
                            total cost, break-down by role
```

The trace folder defaults to `traces/` at the project root; set `TRACE_DIR`
to relocate it. `begin` writes `info.json`, each `callModel` call appends a
numbered file, and the session's `cost-summary.json` is written when the
interview finishes. Call sequence numbers are monotonic and never restart:
a session resumed after a server restart continues numbering (e.g. at
`080`) instead of re-writing from `001`, so a trace folder always holds
exactly one clean attempt.

The frontend has **Review sessions** and **Diff sessions** tabs (next to
Interview). Review lists every traced session and, when you pick one, shows
a reconstructed transcript (questions, answers, clarifying exchanges, Judge
verdicts, Director decisions, stage/final reports), per-role cost bars, and
the full raw prompt + output of every model call. Diff compares two sessions
side by side: a summary table (calls, tokens, cost, counts of questions /
answers / follow-ups / clarifications, verdict mix) plus an aligned timeline,
with rows that differ between the sessions highlighted. The reconstruction
lives in `server/lib/traceAnalysis.js`.

In-progress sessions are snapshotted to `sessions/` after every turn. If
the server goes down mid-interview, restart it and the **Resume** dropdown
in the setup card (or `GET /api/sessions`) lists every session waiting on
an answer; picking one replays the conversation so far and lets you
continue exactly where you left off.

Costs are computed from the provider's reported token usage times a small
per-model price table (US dollars per million tokens):

| Model | Input /1M | Output /1M |
|---|---|---|
| `command-a-plus-05-2026` | $2.50 | $10.00 |
| `command-a-03-2025` | $2.50 | $10.00 |
| `command-r-plus-08-2024` | $2.50 | $10.00 |
| `gpt-4.1-mini` | $0.40 | $1.60 |
| `llama-3.3-70b-versatile` | $0.59 | $0.79 |
| `claude-sonnet-5` | $2.00 | $10.00 |

Per-call `costUsd` and the summary's `totals.costUsd` are `null`/`0` when
the model has no entry in the price table, so unknown models never show a
fabricated number. The table lives in `server/lib/callModel.js` (`PRICING`)
and is easy to extend as prices change.

## Why file-based, no DB, no framework (for now)

The current goal is to validate that the rubrics and prompts actually
produce good judgment, not to build production infrastructure. Markdown
files are the "database" for questions and rubrics; a single process
holds session state in memory and snapshots it to `sessions/` after every
turn so in-progress interviews can be resumed after a restart. None of
this blocks moving to a real database later — the rubric and prompt
content doesn't change either way.

## Folder structure

```
data/stages/<stage>/        questions.md + rubric.md per stage — the content
data/benchmarks/            13 real PM interview studies gathered from the web,
                            plus comparison.md (our mocks vs. real loops) — see
                            data/benchmarks/README.md
prompts/                    one markdown template per AI role
server/config/stage_order.md   how stages are sequenced, per-stage question counts, decisions
server/server.js            the running app (Node stdlib only, no deps)
server/lib/                 loadStage, sessionStore, prompts, promptFiller,
                            callModel, traceStore, traceAnalysis, and
                            interview (the four-role loop)
public/index.html           the single-page frontend
traces/                     per-session model-call traces + cost summaries
sessions/                   in-progress session snapshots for resume (gitignored)
candidates/                 candidate profiles shared across practice rounds (gitignored)
tests/                      automated tests: parsers, store, prompt filling,
                            and full interview flows driven over HTTP
tests/golden-sets/          hand-graded sample answers, one file per stage
tests/director-scenarios/   synthetic scenarios for testing the Director in isolation
docs/architecture.md        the four-role loop, explained in more depth
```

## Next steps, in order

1. Draft the remaining three rubrics (Product Improvement, Strategy,
   Execution/Metrics). Each stage also needs its own directory in
   `data/stages/` and a row in `server/config/stage_order.md`.
2. Fill in real question banks per stage (currently only a handful of
   placeholder questions per stage — enough to test with, not enough to
   avoid repeats across many sessions).
3. Write test scenarios in `tests/director-scenarios/` and validate the
   Director's decisions against them by hand, the same way the Judge was
   validated.
4. Validate the Director's dynamic follow-up decisions (no fixed budgets)
   against the scenarios in `tests/director-scenarios/`, and tune the
   time-budget pacing (`time_budget_minutes` in
   `server/config/stage_order.md`).
