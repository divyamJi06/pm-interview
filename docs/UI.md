# UI specification

**Audience: a UI-generating LLM.** This document describes the interface of a
product-management interview practice app, gives you the exact data each screen
receives, and sets the constraints your output must satisfy so it can be dropped
into the existing codebase without breaking it.

Deliver code. Do not redesign the architecture. Do not add dependencies.

---

## 1. What we are building

A web app where a product manager practises being interviewed by an AI, and
reads what it thought.

A candidate signs in with a Supabase account, fills in a short profile (target
role, years of experience, resume), then runs rounds. A round is a sequence of
turns: the interviewer asks, the candidate answers, and the interviewer scores
the answer on the spot. Full mocks move through seven rounds and end in a
director decision. Practice rounds are a single stage and end in a verdict.

The candidate can type or speak their answers. Every finished round lands in
their history with scores, so progress over time is visible: the dashboard shows
where they are strong and which round to practise next.

The tone is calm, precise and quiet. It is a work tool, not a game. No
confetti, no mascot, no celebration. The only warm colour in the product is the
one that marks a good score, and there are exactly three score colours (see §6).

### Non-goals, and they are not up for discussion

- **No hiring, recruiting, applications, jobs, candidates-as-leads.** An earlier
  version of this app was a recruiting tool. Every screen of it is deleted. If
  your generated UI mentions jobs, applicants, recruiters, offers or applying,
  it is wrong.
- **No camera, no video recording, no clip review.** Voice is audio only.
- **No social features, no sharing, no leaderboards.**
- **No account linking to anything outside Supabase auth.**

---

## 2. Non-negotiable technical constraints

| Constraint | Why |
|---|---|
| React 18, function components, hooks only | existing codebase |
| Tailwind CSS v4, `@tailwindcss/vite` | no CSS files, no CSS modules, no styled-components |
| Colour only through the CSS variables in `src/index.css` | light and dark both work for free |
| `cn()` from `src/lib/utils.js` for every className | tailwind-merge, so overrides do not fight |
| No new npm dependencies | the bundle is already at a chunk warning; a router, a chart library and a form library were all deliberately left out |
| Reuse the components in `src/components/` | see §7 |
| Do not touch `src/App.jsx`, `src/components/Shell.jsx`, `src/app/authContext.jsx`, `src/lib/route.jsx`, `src/lib/utils.js` | they are the integration seam, described in §9 |
| lucide-react icons only | already a dependency |
| TypeScript: **no** | this is a JSX codebase |

### Routing

There is no `react-router`. `src/lib/route.jsx` exports `usePath()`, `navigate(path, {replace})`,
and `matchPath(pattern, path)`. `<a href>` triggers a full page load; use
`navigate()` for in-app links.

### Async

No react-query. Each screen owns its `useState`/`useEffect`. `src/lib/utils.js`
exports:

```js
api(method, path, body?, token?)  // throws Error with .status on failure
setAccessToken(token)             // already wired; do not call
cn, esc, fmtLat, fmtDur, fmtMoney, dateNice, relDate, readLocal, writeLocal
VERDICT_CLASS, DECISION_CLASS
```

`api()` already attaches the signed-in candidate's bearer token. Never write a
bare `fetch()` in a component.

---

## 3. How the UI connects to the backend

One Node server, same origin, prefix `/api`. In development Vite proxies `/api`
to `127.0.0.1:3000`, so the browser only ever sees `/api/...`.

Every response is JSON. Every response carries `ok`. Errors are
`{ok: false, error: "..."}` with a meaningful status:

| status | meaning | what the UI must do |
|---|---|---|
| 400 | bad input, or voice not configured | inline message on the control that caused it |
| 401 | no token, or an expired one (`signIn: true` on the body) | `navigate('/login')`. Never show a raw error toast |
| 403 | that session belongs to someone else | back to `/app` with a "not found" message |
| 404 | gone | empty state, not an error screen |
| 503 | could not verify the token | retry banner, keep the user where they are |

### Authentication

There is no login form logic for you to write. `useAuth()` gives you:

```js
{ user, profile, loading, signedIn, needsOnboarding, configError,
  signIn, signUp, signOut, saveProfile, saveKey, forgetKey, keys }
```

- `configError` is non-empty when Supabase is not configured. The app cannot
  work in that state; show the message prominently on signup and profile.
- `needsOnboarding` is true when the profile exists but is incomplete.
- The provider's keys live in localStorage and are handled by `useAuth()`.
  Do not read localStorage for them.

### The interview is a state machine, not a page

`POST /api/start` returns the first question. `POST /api/answer` returns the
next one. The server decides when the round moves on; the UI renders whatever
state it is handed:

```
state: "question" | "stage_verdict" | "final_report"
```

During a long final report you may receive `{state: "analyzing"}`. **Poll
`GET /api/report/:sessionId` every 2 seconds, up to 60 seconds, then stop and
offer a retry.** The interview screen must survive a page refresh: re-enter via
`/app/practice/interview?session=<id>` and call `GET /api/sessions/:id`.

### Response shapes you will receive

`/api/start` and `/api/answer`:

```jsonc
{
  "ok": true,
  "sessionId": "s-8f3a…",
  "mode": "mock",                      // or "practice"
  "stage": { "name": "Estimation", "index": 1, "total": 7 },
  "stageProgress": { "asked": 3, "expected": 4 },
  "state": "question",
  "question": "Take a product with 100M users…",
  "feedback": null,                    // practice rounds only; a judge object
  "transition": null,                  // { from, to, stageVerdict } at a hand-off
  "transcript": [ /* see below */ ]
}
```

Transcript entries:

```jsonc
{ "type": "question",     "stage": "Estimation", "text": "…", "isFollowUp": false }
{ "type": "clarify",      "stage": "Estimation", "text": "…" }
{ "type": "answer",       "stage": "Estimation", "text": "…", "verdict": "strong",
  "dimension_scores": { "problem_framing": 4, "communication": 3 }, "latencyMs": 820 }
{ "type": "stage_verdict","stage": "Estimation",
  "verdict": { "overall_verdict": "developing", "summary": "…",
               "strengths": ["…"], "gaps": ["…"] } }
```

Final report:

```jsonc
{
  "ok": true,
  "sessionId": "s-8f3a…",
  "state": "final_report",
  "scores": {
    "overall": 72,                                  // 0-100, may be null
    "byDimension": { "problem_framing": 78, "execution": 65 },  // 0-100
    "answersScored": 11
  },
  "counts": { "questions": 14, "answers": 13, "followUps": 4, "clarifications": 2,
              "strong": 4, "developing": 5, "weak": 2 },
  "report": {
    "mode": "mock",
    "verdict": "developing",       // strong | developing | weak
    "summary": "…",
    "strengths": ["…"],
    "gaps": ["…"],
    "patterns": ["…"],
    "recommended_resources": ["…"],
    "stageVerdicts": [ { "stage": "…", "verdict": { /* same shape */ } } ],
    "action_plan": [ { "…": "…" } ],
    "priority_order": [ "…" ]
  }
}
```

Every field of `report` is **optional**. The current UI reads defensively for
exactly this reason, and your replacement must too: a round that lost the coach
call still has to render. Never `report.strengths.map(...)` unguarded.

**Judge dimension scores are 0-5 internally** (`dimension_scores` on a
transcript entry); `scores.byDimension` and `scores.overall` are already
converted to 0-100. Do not mix them up.

### Voice endpoints

```js
GET  /api/transcribe/config?sessionId=&provider=   // {enabled, provider, model, language, byok, reason?}
GET  /api/tts/config                              // {enabled, provider?, model?, voice?, reason?}
POST /api/transcribe  // {audio: base64, contentType, sessionId?, provider?, apiKey?} → {text}
POST /api/tts         // {text, sessionId?} → {audio: base64, contentType}
```

`enabled: false` always comes with `reason`. **Disable the control and show the
reason as a tooltip or inline note.** Do not hide the button — a candidate who
cannot find the mic thinks the app is broken.

### Other endpoints

```js
GET  /api/tracks                     // [{id, label, …}]
GET  /api/stages?track=pm            // [{id, label, questionCount, blurb}]
GET  /api/sessions                   // [{sessionId, stage, mode, …}] — unfinished only
GET  /api/sessions/:id               // {state, question, transcript}
GET  /api/report/:id                 // report payload | {state: "analyzing"}
GET  /api/interviews                 // not an endpoint: history comes from Postgres,
                                     //   via src/lib/interviews.js (see §8)
POST /api/candidates   {track, targetRole, resume}
GET  /api/candidates/:id
POST /api/debrief     {candidateId}
```

---

## 4. Screens

Nine routes. `Shell` (top bar + left nav) wraps everything except
`/app/practice/interview` and `/onboarding`, which are bare.

### 4.1 `/` — Landing (public)

Purpose: explain the product and get the candidate to sign up. No account
required, and a signed-in candidate sees it but is not redirected away.

Sections, top to bottom:

1. **Hero.** Product name, one sentence on what it does, two buttons: primary
   "Get started" → `/signup`, secondary "Sign in" → `/login`. Include one line
   on cost: the candidate brings their own key, or the app runs on the
   operator's key. Do not promise free.
2. **What you practise** (`#features`, muted background band). The seven rounds
   as a grid of cards, each with the stage name and its one-line blurb. Copy is
   in `src/lib/interviews.js` (`STAGES[].blurb`) — reuse it, do not invent
   different stage names.
3. **How it works** (`#how`). Three numbered steps: create an account and
   profile, run a round, read the report.
4. **Privacy band** (muted, `border-t`). Say plainly: your key stays in your
   browser, we keep no copy; audio is transcribed and discarded; your history is
   private to your account.
5. **Closing CTA.** Centred, generous padding. "Start practising" → `/signup`.

### 4.2 `/login`, `/signup` — Auth (public)

One card, centred, max-width ~28rem. Toggle between the two modes in place; do
not make them separate pages.

- **Login:** email, password, submit. On `signIn()` success, `App` redirects to
  `/app` on its own.
- **Signup:** email, password, full name, phone, target role, resume (textarea
  plus a file input that fills the textarea with the file's text). `signUp()`
  takes all of it in one call and writes the profile row. **If
  `signUp()` returns `{needsConfirmation: true}`, replace the form with a
  "check your email" message.** That is not an error state.
- If `configError` is set, show it above the form and disable submit.
- Field-level errors from Supabase read as `err.message` — put them under the
  input, not in a toast.

### 4.3 `/app` — Dashboard (gated)

Purpose: "where am I, and what should I practise next".

1. `PageHeader` — greeting by first name from `profile.full_name`.
2. **Overview section.** Four stat tiles: rounds completed, average score,
   strongest stage, weakest stage. Each tile is a label, a large number, and one
   line of context. A tile with no data shows `—`, never `0`, when nothing has
   been run yet.
3. **Continue an unfinished round.** If `GET /api/sessions` is non-empty, this
   section appears **above** the stats: a card per live session with the stage
   name, when it was started, and a "Resume" button →
   `/app/practice/interview?session=<id>`. This is the highest-value element on
   the page; do not demote it below the fold.
4. **By stage.** A `Meter` per stage with the average score for that stage and a
   count of rounds. Sort ascending by score so the weakest is first.
5. **Recent rounds.** Last five, each a row: date, stage, mode badge
   (`mock`/`practice`), score, verdict chip, → `/app/interviews/:id`.
6. **Practise a round.** One card per stage, each with the blurb and a "Practise
   this" button → `/app/practice` with that stage preselected.
7. **First-run state.** With zero interviews, replace sections 2-5 with one
   `EmptyState`: icon, "No interviews yet", one sentence, primary button
   "Start your first round" → `/app/practice`.

### 4.4 `/app/practice` — Practice setup (gated)

Purpose: configure and launch one round. This screen writes a preset into
`prepContext` and navigates; it does not talk to `/api/start`.

Sections:

1. **Unfinished rounds.** `GET /api/sessions`. If non-empty, a `Select` of
   resume-able sessions with a "Resume" button. Hidden entirely when empty.
2. **Which round?** Radio group of tracks (`GET /api/tracks`), then a radio
   group of stages for the chosen track (`GET /api/stages?track=`), each option
   showing label + question count + blurb. Plus a "Full mock" option that runs
   all seven stages in order.
3. **How will you answer?** `Seg` with Voice on / Voice off. Default to whatever
   `pm-voice-mode` in localStorage says, defaulting to on. Explains that voice
   needs a key in Profile.
4. **Feedback.** `Seg`: `full` (a verdict after every answer) or `simulation`
   (nothing until the end, like a real interview). One line on which to choose.
5. **Before you start.** Checklist showing readiness, each item linking to the
   fix when unmet:
   - profile complete → `/onboarding`
   - a Cohere key saved → `/app/profile`
   - a voice key, if voice is on → `/app/profile`
   - microphone reachable → the browser check below
   If a required item is missing, disable "Start interview" and name what is
   missing. Do not let them start a doomed round.
6. **Ready.** Primary "Start interview" button, plus a resume `<Select>` when
   there is anything to resume.

### 4.5 `/app/practice/interview` — The interview (gated, bare)

**The most important screen in the app. Get this one right.**

- No `Shell`. No nav. A slim top bar: stage name, question counter
  (`Question 3 of 4` / `Round 2 of 7`), and an exit control that asks for
  confirmation.
- Layout: a single centred column, max ~48rem for the conversation, with the
  composer pinned to the bottom of the viewport.
- Conversation is a scrolling transcript. Question bubbles left, candidate
  answers right, clarifications indented and muted, stage verdicts as a full
  width divider. Follow-ups marked "follow-up" so the candidate can see they
  answered well.
- The **current question is always rendered as the last, visually dominant
  element**, regardless of scroll position. Never make the candidate scroll to
  find it.
- **Answer composer.** Two modes:
  - *Text*: `Textarea`, autosize to ~6 rows, Enter sends, Shift+Enter
    newlines. Send button disabled while empty or in flight.
  - *Voice*: one large push-to-talk button. Live level meter. Live interim
    transcript in place, replaced by the final text when recognition settles.
    Silence detection ends the turn; a "too short / mostly filler" warning
    appears under the composer instead of sending, with the candidate free to
    add to it. **Never lose what the candidate said** when rejecting a turn.
- Round feedback, when it arrives after an answer: a compact card with the
  verdict chip, a one-line summary, and the dimension scores as small bars.
  In `simulation` mode there is no per-answer card at all.
- Stage transition: a full-width banner — "Stage complete: Estimation",
  verdict, summary. Then the next stage's first question.
- Failure states, each with a real path forward:
  - `401` → `/login`
  - network failure on send → keep the text in the composer, show "Not sent",
    offer Retry. Do not clear the input.
  - a 5xx from the model → the turn is unsent; say the provider failed.
- **Refresh-safe.** On mount, if `?session=` is present, call
  `GET /api/sessions/:id` and rebuild the whole transcript from the response.
- When `state === "final_report"`, replace the composer with a summary panel
  (scores, counts, verdict) and a primary "Read the full report" →
  `/app/interviews/:id`. If the report is still being written, poll
  (§3) and show a progress state with a spinner and the words "writing your
  report".

### 4.6 `/app/interviews` — History (gated)

1. `PageHeader` — "Interviews", total count.
2. **By stage.** One row per stage: stage name, rounds completed, average
   score, and a `Meter`. Sorted by average score ascending.
3. **Filter bar.** `FilterBar` over `all | mock | practice`, plus a verdict
   filter (`all | strong | developing | weak`). Client-side, instant.
4. **All rounds.** A table on wide screens, stacked cards below `md`. Columns:
   date, stage, mode, questions, score, verdict, chevron. Whole row clickable →
   `/app/interviews/:id`. Sorted newest first.
5. **Empty state:** "No interviews yet" → `/app/practice`.

### 4.7 `/app/interviews/:id` — Report (gated)

Reads the `interviews` row by id, then `GET /api/report/:session_id` for the
payload.

1. `PageHeader` — stage or "Full mock", the date, mode badge, verdict chip.
   Secondary action: "Practise this round again" → `/app/practice`.
2. **Score.** Large overall score (0-100, or `—` if null), a `Meter` per
   dimension from `scores.byDimension`, and the counts row.
3. **Report.** The narrative, in this order, each section hidden when empty:
   - summary paragraph
   - "What you did well" — `strengths`, max three, good tone
   - "What to improve" — `gaps`, max three, weak tone
   - "Patterns" — `patterns`
   - "Your coaching plan" — `priority_order` as an ordered list, then
     `action_plan` items each in a `Disclosure`
   - "Resources" — `recommended_resources` as a quiet link list
   - a `Disclosure` "Explore stage feedback" holding one block per
     `stageVerdicts` entry
4. **Analyzing state:** when the payload is `{state: "analyzing"}`, show a
   skeleton of section 3 and poll per §3.
5. **Error:** if the row exists but the report does not, `StateScreen`
   "Report unavailable" with a Retry button. Do not blame the candidate.

### 4.8 `/app/profile` — Profile and settings (gated)

1. **Your details.** Full name, phone, email, target role, years of experience.
   Save writes through `saveProfile()`.
2. **Resume.** Textarea, hard cap 8000 characters, live counter, and a file
   input that reads a `.txt`/`.md`/`.pdf`-adjacent text file into it. Tell them
   the cap before they hit it.
3. **API keys.** Two `KeyField`s, "Cohere key — runs the interview" and
   "Cohere key — transcribes your voice answers". Each has: masked display
   (`maskKey`), reveal toggle, save, forget. A shape hint from
   `looksLikeCohereKey`, phrased as "save it anyway if you are sure" — never
   block. **State the storage truth in plain words: stored in this browser's
   localStorage, never written to our database, sent only to the interview
   server for the round that needs it, gone for good if they clear site data.**
4. **Account.** Email, member since, "Back to dashboard", "Sign out".

### 4.9 `/onboarding` — First run (gated, bare)

Three steps, one per screen, with a `Stepper` and Back/Next. Do not show the app
nav; they are not useful until they are done.

1. **Your details:** name, phone, email.
2. **What are you interviewing for?** Target role, years of experience, resume.
3. **Ready to go:** confirm what will be used in their interviews, primary
   "Go to dashboard" → `/app`, secondary "Add an API key" → `/app/profile`.

`onboarding_complete` becomes true on save; `App` then stops forcing this route.

---

## 5. States every screen must implement

Four states, not two. Shipping only loading and loaded is the most common way
generated UI fails here.

| state | requirement |
|---|---|
| Loading | `Skeleton` blocks that match the final layout's geometry. Never a centred spinner on a page that will hold a table |
| Empty | `EmptyState` with an icon, one sentence, and the single action that fills it. Never "No data" |
| Error | `StateScreen` with what failed, and a Retry that re-runs the fetch. Never a raw exception |
| Ready | the screen as specified |

Additional rules:

- Every fetch has an in-flight guard; a slow response must not overwrite a
  newer one.
- No layout shift between states. Reserve space for async content.
- Buttons that trigger a request disable themselves and show a spinner in
  place. No double submits.
- Optimistic UI only for reversible things (a filter chip). Never optimistic
  for sending an answer.

---

## 6. Visual language

### Tokens

Defined once in `src/index.css`. Use them as Tailwind classes; never hardcode a
colour.

| token | class | use |
|---|---|---|
| background | `bg-background` | page |
| foreground | `text-foreground` | body |
| card | `bg-card` / `border-border` | surfaces, always with a border, no drop shadows |
| muted | `bg-muted`, `text-muted-foreground` | secondary surfaces, captions, all helper text |
| primary | `bg-primary text-primary-foreground` | exactly one primary action per screen |
| accent | `bg-accent` | hover, active, selected |
| destructive | `text-destructive` | destructive actions and errors only |
| good / developing / weak | `text-good` `text-developing` `text-weak` | verdicts. Nothing else |
| ring | `ring-ring` | focus |
| chart-bars | `fill-chart-bars` | chart bars |

`VERDICT_CLASS` maps `strong→text-good`, `developing→text-developing`,
`weak→text-weak`. `DECISION_CLASS` does the same for
`follow_up | next_question | next_stage | end_interview`.

### Type, space, shape

- System sans stack. `mono` class for scores, session ids and anything numeric
  you want to align in a column.
- Page padding `px-5`, sections stacked at `gap-6`, content column
  `max-w-6xl`.
- Radius scale from `--radius`: `rounded-md` inputs and buttons, `rounded-lg`
  cards, `rounded-xl` for the biggest panels.
- Size ladder: page title `text-2xl font-semibold tracking-tight`, section title
  `text-sm font-medium`, body `text-sm`, helper `text-xs`.
- Body copy in `leading-relaxed`. Numeric displays in `tabular-nums`.
- Transitions `transition-colors`, 150ms. One easing. No layout animation.

### Dark mode

`index.css` defines a full `.dark` token set and the interview screen uses it.
Your UI must read only tokens. If you need an alpha variant, use
`bg-muted/30` — never `rgba()`.

### Accessibility, non-negotiable

- Every icon-only control has `aria-label`. Lucide icons are decorative:
  `aria-hidden="true"`.
- The transcript and the composer are one focus-ordered region; keyboard-only
  use must be able to start an interview, answer, and read the report.
- Visible focus: `focus-visible:ring-2 ring-ring`. Never `outline-none` alone.
- Verdict is never colour alone — pair the colour with the word.
- Contrast at `text-xs` on `text-muted-foreground` is the floor. If it looks
  thin, it fails.
- `prefers-reduced-motion`: disable the pulse on a live recording indicator.

---

## 7. Components that already exist — reuse them

Do not re-create these. Import and compose.

`src/components/ui.jsx`
`Button` (variants `default|secondary|ghost|outline|destructive`, sizes
`sm|default|lg`), `Card`, `CardHeader`, `CardContent`, `Badge`, `Label`,
`Input`, `Textarea`, `Select`, `Separator`, `Tabs`/`TabsList`/`TabsTrigger`,
`Seg` (segmented radio), `Progress` (question counter, `index`/`total`),
`Skeleton`, `verdictPill(v)`.

`src/components/primitives.jsx`
`PageHeader` (`title`, `description`, `action`), `Section` (`title`,
`description`, `action`), `Divider`, `KeyValue`, `Meter` (`value`, `max`, `label`),
`Stepper` (`steps`, `current`), `FilterBar`, `Disclosure`,
`StateScreen` (`icon`, `tone`, `title`, `message`, `primary`, `secondary`),
`EmptyState` (`icon`, `title`, `message`, `action`), `ObjectCard`,
`ObjectCardBody`.

`src/components/charts.jsx` — hand-rolled SVG, no chart library
`MonoBar({label, sub, value, frac, fmt})`, `Chip({label, value, tone})`,
`Funnel({stages})`, `VerdictSpark({strong, developing, weak})`.

`src/lib/utils.js`
`cn`, `esc` (**use it for any model-generated string that is not
`dangerouslySetInnerHTML` — model output is untrusted**), `fmtLat`, `fmtDur`,
`dateNice`, `relDate`.

`src/lib/interviews.js`
`STAGES` (id, label, blurb), `STAGE_LABEL`, `stageLabel`, `scoreFromReport`,
`countsFromReport`, `summarise`.

### Components you should create

Only these, and only if they do not exist:

- `StatTile` — label, big value, one line of context. Used on the dashboard.
- `ScoreBars` — dimension scores as labelled bars, sorted weakest first.
- `TranscriptMessage` — one transcript entry, typed by `type`.
- `MicButton` — push-to-talk with level meter.
- `ChecklistRow` — ready/not-ready row with a link to the fix.

Each in `src/components/`, named as above, taking plain props. No context, no
data fetching inside them.

---

## 8. History data comes from Postgres, not `/api`

Do not fetch history over HTTP. `src/lib/interviews.js` owns it:

```js
// write path — call once at the start of a round and once when it finishes
createInterviewRow({ sessionId, mode, stage, feedbackMode, voiceMode, targetRole })
findInterviewBySession(sessionId)   // → row | null
finishInterviewRow(interviewId, patch)
saveReport(interviewId, report)
getReport(interviewId)

// read path — RLS already scopes it, there is no user filter and you must not add one
listInterviews()                    // → rows, newest first
scoreFromReport(payload)
countsFromReport(payload)
summarise(rows)                     // totals, averages, per stage, best/worst
stageLabel(stage)
```

There is no `startInterviewRow`, no `getInterviewRow`, no `listInterviews({userId})`.
Write with `createInterviewRow` + `finishInterviewRow`, read with
`listInterviews()`.

Rows look like:

```jsonc
{ "id": "uuid", "session_id": "s-8f3a…", "mode": "mock", "stage": "estimation",
  "status": "completed", "started_at": "…", "completed_at": "…",
  "question_count": 14, "answer_count": 13,
  "overall_score": 72, "stage_scores": { "estimation": 78 },
  "strongest_dimension": "problem_framing", "weakest_dimension": "execution" }
```

If Supabase is not configured, `listInterviews()` returns `[]` and the
dashboard shows its empty state. Do not add an API fallback for history.

Also available and worth reusing rather than rewriting: `src/lib/vad.js`
exports `createVad`, `isSubstantiveAnswer`, `countWords`, `contentWords`,
`isFillerOnly`, `DEFAULT_VAD_OPTIONS`, `DEFAULT_ANSWER_GUARD`, and
`src/lib/speech.js` exports the `Recorder` and `Speaker` classes plus
`base64ToBlob` and `pickAudioMime`. If your interview screen needs to
understand silence, filler or a weak answer, call `isSubstantiveAnswer` — do
not re-implement the rule.

---

## 9. How your code gets integrated

You return **files**, not patches to files you have not been given. I drop them
in, wire imports, run the build and the tests, and fix what breaks.

**Do not modify, and assume these already exist as described:**

| file | why it is off-limits |
|---|---|
| `src/App.jsx` | the router, the auth redirects, the onboarding gate, which pages get `Shell` |
| `src/app/authContext.jsx` | session, profile, keys |
| `src/app/prepContext.jsx` | the setup → interview handoff |
| `src/components/Shell.jsx` | nav chrome and theme toggle |
| `src/lib/route.jsx` | `usePath`, `navigate`, `matchPath` |
| `src/lib/utils.js` | `api`, `cn`, formatters |
| `src/lib/interviews.js` | history access |
| `src/lib/apiKeys.js`, `src/lib/speech.js`, `src/lib/vad.js`, `src/lib/supabase.js` | keys, mic, voice gate, client |
| `src/index.css` | tokens |

**The view files you are replacing or authoring:**

```
src/views/LandingPage.jsx        src/app/DashboardView.jsx
src/views/AuthPage.jsx           src/app/PracticeSetupView.jsx
src/views/InterviewView.jsx      src/app/InterviewsView.jsx
src/app/OnboardingView.jsx       src/app/InterviewDetailView.jsx
src/app/ProfileView.jsx          src/app/ReportBody.jsx
```

Each default-exports one component taking only props that already exist in
`App.jsx` (`DashboardView` takes `onStartPractice`; `InterviewView` takes
`preset` and `onPresetConsumed`). Keep those signatures or tell me what you need
changed.

### Rules for the code you return

1. One component per file. A screen file may compose shared components but
   should not define four of them inline.
2. Every file ends up valid JSX with no TypeScript syntax.
3. No `any` equivalents, no `@ts-ignore`, no placeholder comments like
   `// implement this`.
4. No dead code, no unused imports, no commented-out blocks.
5. Accessible names on every control. See §6.
6. `useEffect` cleanup for anything that subscribes or polls.
7. Comments explain **why**, not what. No comment restating the JSX above it.
8. Every screen implements all four states from §5.
9. Report shape is defended with optional chaining and `list()`-style helpers.
   Model output is untrusted and incomplete.
10. No hardcoded hex, no `px` values where a token exists, no new colours.

### What I will check before accepting it

`npm run build` clean, every fetch has loading/empty/error, keyboard path
through the interview works, no console errors, light and dark both legible, no
mention of jobs or applicants, no new dependency, and the server's actual
response shapes match what your UI renders.

If you need a field the backend does not send, or a route that does not exist,
**say so in your response instead of inventing it.** I will add it.

---

## 10. Reference: existing content to reuse

Stage labels and blurbs are in `src/lib/interviews.js` — copy them verbatim so
the setup screen, dashboard and history cannot disagree.

The four interview roles are Recruiter, Hiring Manager, Judge and Director. A
mock runs stages in this order: `estimation`, `product_design`, `case_study`,
`strategy`, `data_analysis`, `execution`, `leadership`, ending in a director
decision. A practice round is one stage and ends in a stage verdict.

Verdict vocabulary, everywhere, exactly these three words: **strong**,
**developing**, **weak**. A score of 0-100 is shown as a number, never as a
percentage sign.