# Frontend

`frontend/` is a standalone Vite + React 18 app with its own `package.json` and
`node_modules`. It was split out of the old `public/index.html` monolith on this
branch, and the monolith is still there as the server's fallback.

The split is a packaging change, not an architecture change. The browser talks
to one `/api` and nothing else.

## Running it

```bash
npm run dev:api     # terminal 1 - Node server on :3000
npm run dev:web     # terminal 2 - Vite on :5173, proxying /api to :3000
```

`frontend/vite.config.js` holds the only piece of coupling between the two: the
`/api` proxy, plus `base: '/'` and `outDir: 'dist'`. Change `server.port` and you
change that one string.

For a single process, build first and start the server; it prefers
`frontend/dist/index.html` and falls back to `public/index.html` when the build
is missing, so a forgotten build fails visibly rather than serving a stale app.

## Why a custom router

`frontend/src/lib/route.jsx` is about 30 lines: `usePath`, `navigate`, and
`matchPath`. No `react-router`.

The branch kept the constraint that started it — the interview itself must not
depend on a third-party route change mid-round, because a route change
re-renders and drops the microphone stream and the VAD state. A router with
history, links and params, and no provider to nest, is enough for seven routes
and removes a dependency from the most fragile screen in the app.

If this app grows nested layouts or per-route data loading, that is the point to
revisit the decision — not before.

## Routes

Split three ways in `App.jsx`:

| route | who sees it |
|---|---|
| `/` | anyone |
| `/login`, `/signup` | anyone, but a signed-in candidate is redirected to `/app` |
| `/app` | dashboard: stats, recent interviews, live round to resume |
| `/app/practice`, `/app/practice/setup` | pick track, stage, feedback mode, voice, target role, resume |
| `/app/practice/interview?session=<id>` | the interview itself. **bare** — no app chrome |
| `/app/interviews` | history from Postgres |
| `/app/interviews/:id` | one stored report |
| `/app/profile` | profile and BYOK settings |
| `/onboarding` | forced when the profile has `onboarding_complete: false` |

Redirects: `!signedIn` on any non-public route goes to `/login`; a signed-in
candidate on `/login` goes to `/app`; `needsOnboarding` on any non-interview
route goes to `/onboarding`. `/app/practice/interview` is exempt from the
onboarding gate so a live round can be rejoined even if the profile is
incomplete.

The interview screen is deliberately chrome-free — an interview is a full page,
not a tab — which is why `AppShell` excludes that path from `Shell`.

## State

Two providers, both in `app/`.

`authContext.jsx` owns the signed-in candidate: Supabase session, `profiles`
row, and BYOK material. Three consequences worth knowing:

- The session, not a localStorage boolean, is the source of truth. A refresh or
  a second tab cannot disagree about who is signed in.
- The access token is published to `lib/utils.js` on every session change, so
  every `api()` call is authenticated without threading the session through
  call sites. A new call site that forgot the token fails loudly against the
  server instead of reading as anonymous.
- Signup collects the whole profile in one form, so the `profiles` insert is one
  round trip rather than a create followed by an update the candidate can
  navigate away from halfway.

`prepContext.jsx` carries a practice preset — the interview view's `preset`
prop, plus `?session=` folded in — from the setup screen to the interview. It is
a scratchpad for handoff, not application state.

`lib/interviews.js` writes history rows: one `interviews` upsert at start and one
at finish. No state library, and none is needed at this size.

## Voice

`speech.js` wraps `SpeechRecognition` with normalised interim/final events.
`vad.js` is the voice-activity gate: it decides when a turn is over, so the
candidate does not have to click a button to finish answering.

`/api/transcribe/config` and `/api/tts/config` gate the UI. When a provider is
off the endpoint returns `enabled: false` **with a reason**, so the mic button
can explain itself rather than being silently dead — the button is disabled with
a tooltip, not hidden.

## Layout

- `components/ui.jsx` — shadcn-style primitives: `Button`, `Input`, `Textarea`,
  `Label`, `Card`, `Badge`, `Radio`, `Dialog`.
- `components/charts.jsx` — hand-rolled SVG, no chart dependency: `MonoBar`
  (labelled bar with a value and a sub-label), `Chip` (label/value pair),
  `Funnel` (stage progression), `VerdictSpark` (strong/developing/weak mix).
  Dimension scores reuse `Meter` from `primitives.jsx`.
- `components/Shell.jsx`, `components/primitives.jsx` — app chrome and the
  typed variants (`verdictChip`, `decisionChip`, `cls`).
- `lib/utils.js` — `cn` (tailwind-merge + clsx), the `api()` wrapper, and
  formatters.
- `lib/theme.js`, `index.css` — light/dark tokens, including the `.dark` class
  used for the interview screen.

## What was removed

The ace build's hiring surface is gone: jobs browse and detail, applications,
apply, `candidateContext`, the applicant camera/recording flow,
`sessionRecorder.js`, and the Review/Diff tabs. Tracing and trace analysis are
unaffected — see the `/api/traces` routes in [api.md](api.md).

## Build notes

`npm run build` from the repo root builds this app. The bundle warns about a
chunk over 500 kB; that is the chart and interview code in one chunk, and it is
not worth splitting until there is a measured problem.

`frontend/dist/` is gitignored. It is build output, not source, and the server
regenerates it on demand.