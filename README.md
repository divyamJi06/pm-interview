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
  in-memory sessions, and a React frontend (`frontend/`, built with Vite).
  `npm run build` emits `frontend/dist`, which the server serves in
  preference to the legacy `public/index.html` monolith; deep links like
  `/app/profile` fall back to the app shell.
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
- **A Coach agent** (`prompts/coach.md`, `server/lib/coach.js`) runs after
  every practice round (action plan shown right next to the round verdict)
  and once per full debrief — at the end of a full mock interview or when
  a practice candidate finishes all gradeable stages — and rewrites the
  candidate's actual weak moments into a prioritized, concrete
  `action_plan` / `priority_order`, which rides along on the same
  final-report response, persists with the session / candidate debrief,
  and is tagged `coach` in Review sessions.
- At setup you can optionally paste your resume / background; it is held
  per session (capped at 8,000 characters) and fed to the profile-writer,
  which folds relevant facts into the running candidate profile so later
  stages judge with real context about the interviewee.
- **Voice-to-text answers**: a mic button in the chat lets you speak an
  answer instead of typing it. Audio is recorded in the browser
  (`MediaRecorder`), sent as base64 to `POST /api/transcribe`, and
  transcribed by one configured provider (`server/lib/transcribe.js`) with
  one plain `fetch` call — no SDK, no streaming, no websocket. The
  transcript lands in the answer box where you can read, edit, and then
  send it — the Judge always sees the text you actually submit. Pick a
  provider with `STT_PROVIDER` (`deepgram` default | `openai` | `cohere`)
  and set its API key in `.env`; until a key is present the mic button is
  disabled and `/api/transcribe/config` reports why. `cohere` requires
  `STT_LANGUAGE` and does not accept webm/opus (flac/mp3/mpeg/mpga/ogg/wav
  only) — the client detects that and decodes the Chrome/Firefox webm
  clip, re-encodes a 16 kHz mono WAV, and uploads that, so cohere works on
  every browser. Each transcription is priced per minute of audio and
  tagged `stt` in the existing `cost-summary.json` per-role breakdown.

- **Accounts are optional but real when configured.** Supabase owns
  profiles, interview history and reports (`supabase/migrations/001_init.sql`,
  row level security on). With the Supabase URL + publishable/anon key set on
  the server, every `/api/*` route requires a Supabase JWT
  (`Authorization: Bearer`) and can only touch that user's sessions and
  candidates. With no Supabase env the server runs open on localhost, which
  is the single-user dev mode.
- **Bring-your-own-key.** The interview can run on the candidate's own Cohere
  key instead of the server's: keys are entered in `/app/profile`, kept in
  `localStorage` (`pm-key:llm`, `pm-key:stt`), and sent per request to
  `/api/start`. We keep no copy — there is no key table in the database and no
  sync. The server holds a key in memory for that session only, never writes it
  to disk or to a trace, and forgets it on restart. Clearing site data deletes
  it for good.

## Running it

The app auto-loads a `.env` file from the project root on startup (copy
`.env.example` and fill in the key for your provider):

```sh
# .env
AI_PROVIDER=cohere            # default is cohere anyway
COHERE_API_KEY=your-key-here
```

```sh
npm start                     # http://127.0.0.1:3000  (API + built frontend)
```

### Frontend

The UI is a Vite app in `frontend/`. For development run the API and Vite
side by side — Vite proxies `/api` to port 3000:

```sh
npm install --prefix frontend
npm run dev:web                       # http://127.0.0.1:5173
```

For a production-style run, build once and let the Node server serve it:

```sh
npm run build                       # writes frontend/dist (git-ignored)
npm start                          # serves the built app on :3000
```

### Accounts (Supabase, optional)

```sh
# run once in the Supabase SQL editor
supabase/migrations/001_init.sql

# frontend/.env.local  (VITE_ vars are the only ones the browser sees)
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# .env (server side, enables the auth gate)
# any of these name pairs works: SUPABASE_URL/SUPABASE_ANON_KEY, or the
# NEXT_PUBLIC_ spellings copied from a Next.js tutorial
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
```

The anon key is safe in the browser; row level security is what keeps users
apart. Never ship the `service_role` key to the frontend. Without Supabase
configured the app still runs — no accounts, no history sync, open API on
localhost.

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

Traces are read back over HTTP: `GET /api/traces` lists every traced session and
`GET /api/traces/:name` returns a reconstructed transcript (questions, answers,
clarifying exchanges, Judge verdicts, Director decisions, stage/final reports),
per-role cost bars, and the raw prompt + output of every model call. The
reconstruction lives in `server/lib/traceAnalysis.js`. Both routes require a
signed-in candidate once Supabase is configured.

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

## Why file-based content, in-memory sessions

The rubrics, questions, prompts and coaching bank are markdown files on
disk — content is meant to be diffable and hand-editable, not queried.
A single process holds session state in memory and snapshots it to
`sessions/` after every turn so in-progress interviews resume after a
restart.

A database arrived only where it was actually needed: durable, per-user
data. Supabase now stores profiles, interview history, reports and
optional key sync (`supabase/migrations/001_init.sql`). Sessions,
candidates and rubric content stay on disk/in memory, because that is
what makes a single-process run reproducible and easy to inspect.


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
                            callModel, traceStore, traceAnalysis, transcribe,
                            and interview (the four-role loop)
frontend/                   the React app (Vite): landing, auth, onboarding,
                            dashboard, practice setup, interview, history,
                            report detail, profile/key settings
frontend/dist/              build output, git-ignored, served by server/server.js
public/index.html           legacy single-page frontend (fallback)
supabase/migrations/        SQL schema + row level security
traces/                     per-session model-call traces + cost summaries
sessions/                   in-progress session snapshots for resume (gitignored)
candidates/                 candidate profiles shared across practice rounds (gitignored)
tests/                      automated tests: parsers, store, prompt filling,
                            and full interview flows driven over HTTP
tests/golden-sets/          hand-graded sample answers, one file per stage
tests/director-scenarios/   synthetic scenarios for testing the Director in isolation
docs/architecture.md        the four-role loop, explained in more depth
docs/workflow.md           session lifecycle, stage flow, reporting
docs/api.md                HTTP reference, auth model, error codes
docs/frontend.md           React app: routing, state, components, build
docs/accounts.md           Supabase setup, schema, RLS, what is stored
docs/keys.md               bring-your-own-key: where keys live, why
docs/UI.md                 UI specification for redesigning the interface
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
