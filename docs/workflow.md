# Interview Engine Workflow

This document describes how the interview engine turns a candidate answer into the
next interviewer interaction: every model call, its inputs and outputs, the ordering
of calls per flow, and where the response latency comes from.

Source of truth: `server/lib/interview.js`, `server/lib/coach.js`,
`server/lib/callModel.js`, `server/lib/traceAnalysis.js`.

## 1. Model configuration

All language-model calls go through one `callModel` instance
(`server/lib/callModel.js`) so every call shares the same provider, model, and
defaults.

| Setting | Value |
|---|---|
| Provider | Cohere (`COHERE_API_KEY`) |
| Model | `command-a-plus-05-2026` (reasoning model) unless overridden by `COHERE_MODEL` / `AI_MODEL` |
| Temperature | 0 |
| Thinking budget | 2048 tokens by default, applied only on the Cohere reasoning model |
| Retries | 2, backoff 400ms, only on 429 / 5xx |

Speech transcription is separate (Deepgram `nova-3` or Cohere
`cohere-transcribe-03-2026` via `server/lib/transcribe.js`) and runs before the
answer is submitted; it is not part of the answer-to-reply path.

### Per-call reasoning budget override

`callModel` accepts `opts.thinkTokens`. `0` removes the `thinking` block from the
Cohere request entirely (the API rejects a zero budget). Absent the override, the
call uses the global 2048 default. `interview.js` sets an explicit budget per role
so expensive reasoning is spent only where a real judgment happens.

- Auxiliary/mechanical roles (`classify-turn`, `director-clarify-*`):
  `thinkTokens: 0`.
- `director-*`: `thinkTokens: 512` (needs light judgment).
- `judge-*` and the synthesizers/coach: default `2048`.

The per-answer candidate profile note is written by the judge call itself
(`updated_profile` in its output), so there is no separate profile-writer
call. `runProfileWriter` was merged into `runJudge`; `prompts/profile_writer.md`
is retained only as reference and is never loaded.

## 2. Call inventory

Each row is one LLM call. Templates live in `prompts/*.md`. `max_tokens` uses
`overrideMaxTokens` where set, otherwise the 4096 default.

| # | Label (trace) | Template | Input | Output (JSON) | max_tokens |
|---|---|---|---|---|---|
| 1 | `classify-turn` | `classify_turn.md` | current question + candidate message | `{ type: 'clarify' \| 'answer' }` | 4096 |
| 2 | `judge-<stage>` | `judge_dimension.md` or `judge_checklist.md` (estimation = checklist) | rubric (intent, ideal structure, scoring dimensions, green/red flags) + question + answer + candidate profile + resume + clarifications | `{ overall_verdict, summary, dimension_scores {}, checklist_hits {}, green_flags_hit [], red_flags_hit [], updated_profile [] }` | 4096 |
| 3 | `director-<stage>` | `director.md` | stage intent + progress (questions asked/remaining, follow-ups, clarifications, turns) + timing (elapsed/budget/ratio) + judge JSON + profile | `{ decision, follow_up_question?, reasoning }` — `follow_up` \| `next_question` \| `next_stage` \| `end_interview` | 4096 |
| 4 | `director-clarify-<stage>` | `director_clarify.md` | stage rubric + question + candidate clarifying question + profile + progress | `{ answer, wrap_up }` | 4096 |
| 5 | `synthesizer-stage-<stage>` | `synthesizer_stage.md` | stage question/answer/judge triples | `{ stage_verdict, summary, strengths [], gaps [] }` | 8192 |
| 6 | `synthesizer-interview` | `synthesizer_interview.md` | all stage verdicts + final profile + resource bank | `{ overall_verdict, summary, top_things_to_work_on [], recommended_resources [] }` | 8192 |
| 7 | `coach` | `coach.md` | stage or hub verdict + full transcript excerpt (the largest input, 5–15k tokens in a late interview) + resource bank | `{ action_plan [], priority_order [] }` | 8192 |

The judge call both grades the answer and updates `session.profile` from
`updated_profile` (capped at 12 notes). `updated_profile` is stripped from the
judge JSON before it is stored on the triple, so `director`, the synthesizers,
the coach, and the transcript UI never see the profile list inside judge
output.

## 3. Flows

### 3.1 Practice mode - an answer on a judged stage

```
candidate sends text
  ├─ heuristic: len > 160 and no "?"  -> answer         (0 calls)
  ├─ heuristic: len <= 24 and has "?" -> clarify        (0 calls)
  └─ call 1 classify-turn -> answer
       │
       processAnswer:
       │  call 2 judge (grades + writes candidate profile)
       │  call 3 director
       └─ decision
            follow_up     -> state=follow_up, question from director      (0 extra calls)
            next_question -> picks unasked question from stage bank (rng) (0 calls)
            next_stage    -> call 5 synthesizer-stage, move, next question (1 call)
            end (guard: 10 turns or time budget reached)
                          -> call 5 + call 7 coach -> final_report
```

The critical path is `classify-turn -> judge -> director`: three sequential LLM
calls plus three API round-trips.

### 3.2 Clarifying question flow

```
text -> heuristic or classify-turn -> 'clarify'
  guard: max 3 clarifications per question, or the interviewer already asked to answer
  call 5 director-clarify -> { answer, wrap_up }
  if wrap_up: clarifyPhaseEnded = true
  state = clarify_reply, clarification stored in pendingClarifications
  next submission is classified again (answer or another clarify)
```

### 3.3 Mock mode (full interview)

Same answer pipeline. Differences:

- Per-answer judge feedback is hidden; verdicts are revealed at stage boundaries.
- The `greeting` stage has mode `none`, so it uses `runSimpleDirector`, a
  bank-progress counter with no LLM call.
- Finishing the last stage runs `synthesizer-stage` (if not yet run), then call 6
  `synthesizer-interview` (hub report) and call 7 `coach`.

### 3.4 No-model paths

`begin`, `resume`, `handleNextQuestion`, and `pickUnaskedQuestion` are pure state
re-hydration and question-bank selection. `resume` replays the transcript from the
session store with no LLM traffic.

## 4. Latency

### 4.1 Where the time goes

Measured before the profile merge and think-budget pushes, end-to-end was about
**22 seconds** on the default reasoning model. Budget per answer on a judged
practice stage now:

```
classify-turn   ~0.7s (0 thinking tokens)
judge           ~8s   (2048 thinking + large generation, max 4096, also writes the profile note)
director        ~1.5s (512 thinking)
------------------------------------------
sum             ~10s  + API round-trips/SSL ≈ 12s
```

The dominant cost is now the judge call alone: 2048-token thinking budget plus
the largest generation in the loop.

### 4.2 Applied mitigations

| Change | Effect |
|---|---|
| Per-call `thinkTokens` override | route-role thinking can be zeroed (implemented in `callModel.js`) |
| `classify-turn` -> thinking 0 | saves ~2.5-3s (implemented) |
| `director-clarify-*` -> thinking 0 | saves ~2.5-3s on clarify replies (implemented) |
| `director-*` -> thinking 512 | saves ~2s with light judgment retained (implemented) |
| profile writer merged into `judge` | removes one model call + round trip per answer; judge writes `updated_profile` (implemented) |
| judge max_tokens 8192 -> 4096 | cuts generation time (implemented) |
| Omit `thinking` block when budget is 0 (Cohere rejects `token_budget: 0`) | lets zero-budget calls succeed (implemented) |

Expected end-to-end after the think-budget pushes and profile merge: roughly
**11-12s**, about 45-50% faster than the original 22s. Costs drop too: thinking
tokens bill at the output-token rate.

### 4.3 Not yet applied (candidates)

- Parallelize the `director` with nothing left in the loop — the profile call
  is gone, so the only remaining serial chain is `classify -> judge -> director`.
  Streaming is the only remaining lever that meaningfully cuts perceived
  latency; the chain itself is three calls.
- Stream partial output to the client for perceived instant replies. Real
  latency unchanged; larger UI/server change.
- Switch the default to `command-a-03-2025` (no reasoner path on Cohere). Fastest
  option but loses built-in reasoning on the judge call.
- Fold `classify-turn` into the judge was considered and rejected: the
  classifier is a cheap gate that keeps the expensive judge off clarifying
  turns. Merging would force the judge to run on clarify traffic (~3s -> ~11s).

## 5. Observability

- Every call is serialized to `data/traces/<sessionId>/calls/` by
  `traceStore.recordCall` with `durationMs`, `usage`, `costUsd`, prompt, and
  output.
- Each answer records end-to-end latency and total cost to
  `data/traces/<sessionId>/answers.json` (`traceStore.recordAnswer`).
- The review tab aggregates both: "Latency per stage" (`answerByStage`) and
  summary chips (`answerStats`), served by `GET /api/traces/:id`.

## 6. Voice mode

Single toggle, **on by default**, shared by practice and mock modes. Enabled =
interviewer questions are spoken aloud and the answer textbox is hidden; the
candidate answers with the microphone and the transcript is auto-submitted.

- Answer input is unchanged server-side: the mic records → `POST /api/transcribe`
  (STT) → the transcript is sent to `POST /api/answer` as normal text. A
  `classify-turn`/`clarify` answer routed to `processClarify` needs no special
  handling.
- A `voice-mode` value is kept in `localStorage` (`on` is the default when the
  key is absent). `setVoiceMode` toggles `#inputbar.voice-on`, which hides the
  textarea and Send button and stretches the mic button to fill the bar.
- Interviewer speech (questions, follow-ups, clarification answers) is spoken
  through the TTS adapter in `public/index.html` when voice mode is on. Stage
  banners and the final report stay as text.

### TTS adapter

`server/lib/speech.js` mirrors the STT provider pattern. `speak({ text })`
returns `{ audio, contentType, costUsd }`; OpenAI models are priced from the
published per-million-character rate (`PRICING`), Deepgram Aura is billed per
package so it records `costUsd: null`. Text is capped at `MAX_TTS_CHARS`
(2000) characters.

| Provider | Env key | Model env | Default model | Voice env | Default voice |
|---|---|---|---|---|---|
| `deepgram` | `DEEPGRAM_API_KEY` | `DEEPGRAM_TTS_MODEL` | `aura-2-en-default` | `TTS_VOICE` | model name |
| `openai` | `OPENAI_API_KEY` | `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | `TTS_VOICE` | `alloy` |

- `provider` defaults to `deepgram`, but the server engine only activates when
  `TTS_PROVIDER` is explicitly set **and** a key is present; otherwise
  `GET /api/tts/config` reports `engine: 'browser'` and the client's built-in
  `speechSynthesis` speaks. This keeps the default cost-free even on machines
  that already have `DEEPGRAM_API_KEY` for STT.
- `POST /api/tts` returns `{ audio, contentType }` (base64). Successful calls
  are traced as `tts` rows via `traceStore.recordCall` with `provider`, `model`,
  `durationMs`, `costUsd`, and the spoken `prompt`.
- The client adapter prefers the server engine when configured and falls back
  to `speechSynthesis` on any server failure (including browser autoplay
  rejection), so a broken TTS key never blocks the interview.
- v2 (planned): record the candidate's answers for later playback.

## 7. Interview end flow

Final report (stage synthesis, overall report, coach plan, candidate merge,
auto-debrief) is expensive: ~10-20 s of extra model time. To avoid a silent
hang after the last answer, the app separates announcement from analysis:

- `POST /api/answer` returns `state: 'analyzing'` as soon as the interviewer
  decides the session is over. The UI shows **"Interview ended — we are
  analyzing your interview to give you insights. This may take a few minutes."**
  and keeps the progress view visible.
- The client polls `GET /api/report/:sessionId` every 2.5 s. The background
  job builds the final report in `server/lib/interview.js`
  (`finalizeSession` → `finishMockInterview` / `finishPracticeSession`), merges
  the session into the candidate, and stores the finished payload on the
  session object (`session.finalPayload`).
- The poll returns `{ ok, state: 'analyzing' }` while the job runs and
  `{ ok, state: 'final_report', report, candidate, debrief }` when ready; the
  UI then renders the normal report. If a poll arrives with no payload (e.g.
  the server restarted mid-analysis), the report route re-kicks the job.
- Direct `processAnswer` callers (tests) keep the synchronous path unless they
  opt in via `deps.deferFinalReport`; the shipped server always defers
  (`createServer({ deferFinalReport: true })`).

## 8. Tests

`npm test` runs `node --test "tests/*.test.js"` — zero third-party dependencies.
The deferred end flow, the `TTS_PROVIDER` opt-in gating, and the browser
engine default are covered in `tests/server.test.js` and
`tests/ttsEndpoint.test.js`. Note: `server.js` loads `.env` into the process
at `require()` time, so tests that assert "provider not configured" call
`withoutProvider()` to neutralize any locally-set `TTS_PROVIDER`.