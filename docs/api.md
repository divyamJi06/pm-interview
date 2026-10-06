# HTTP API

Every route is served by `server/server.js` on one port. There is no separate API
host: the same process that serves the built frontend serves the API, and Vite
proxies `/api` to it in development.

Auth column: **public** needs no token; **token** needs `Authorization: Bearer
<supabase access token>` once Supabase is configured; **owner** additionally
checks that the session belongs to the caller. See
[accounts.md](accounts.md).

## Static

| route | notes |
|---|---|
| `GET /`, `GET /index.html` | the app shell. `frontend/dist/index.html` when built, otherwise `public/index.html` |
| `GET /<path>.{js,css,svg,png,...}` | from the same directory. `html` is `no-store`, hashed assets are cached an hour |
| `GET /<anything else>` | no file extension and not under `/api` → the shell, so `/app/profile` survives a refresh |
| anything outside the served directory | 404. Path traversal is rejected |

## Public

| route | returns |
|---|---|
| `GET /api/health` | `{ok, auth: {configured, enforced, cacheSize}}` |
| `GET /api/stages?track=pm` | stage ids, labels and question counts for the track |
| `GET /api/tracks` | the available tracks |

## Session lifecycle

| route | auth | notes |
|---|---|---|
| `POST /api/start` | token | body: `mode` (`mock`\|`practice`), `stage`, `track`, `feedback`, `voiceMode`, `targetRole`, `resume`, `candidateId`, `apiKey`, `sttApiKey`. Returns the first question plus the session id. Session is stamped with the verified user id |
| `POST /api/answer` | owner | body: `sessionId`, `answer`. Returns the next question or a stage verdict. Clarifying questions are auto-detected in the same turn |
| `GET /api/sessions` | token | active sessions waiting on an answer, for the resume list |
| `GET /api/sessions/:id` | owner | replays the conversation so far so a round can be rejoined |
| `GET /api/report/:id` | owner | `{state: "analyzing"}` while the final report is still being written, then `{state: "final_report", ...}` |

A resumed interview keeps its original `session_id`, so the report lands on the
same `interviews` row rather than creating a second history entry.

## Candidates (practice library)

| route | auth | notes |
|---|---|---|
| `GET /api/candidates` | token | file-backed, shared across users — see the gap noted in [accounts.md](accounts.md) |
| `GET /api/candidates/:id` | token | |
| `POST /api/candidates` | token | body: `track`, `targetRole`, `resume`. Costs one model call |
| `POST /api/debrief` | token | body: `candidateId`. Runs the candidate-level debrief |

## Voice

| route | auth | notes |
|---|---|---|
| `GET /api/transcribe/config?sessionId=&provider=` | token | `{enabled, provider, model, language, byok}`. `enabled: false` comes with the reason, so the mic button can explain itself instead of being silently dead |
| `POST /api/transcribe` | owner when `sessionId` names a session | body: `audio` as base64, `contentType`, optional `provider`/`apiKey`. Priced per minute of audio and tagged `stt` in the cost summary |
| `GET /api/tts/config` | token | which engine will speak, or that it is off |
| `POST /api/tts` | token | body: `text`, `sessionId`. Returns base64 audio |

A transcription request with no key anywhere is refused rather than sent
upstream unauthenticated.

## Traces

| route | auth | notes |
|---|---|---|
| `GET /api/traces` | token | every traced session, newest first |
| `GET /api/traces/:name` | token | reconstructed transcript, per-role cost, and the raw prompt and output of every model call |

## Errors

`{ok: false, error: "..."}`, with the status carrying the meaning:

| status | when |
|---|---|
| `400` | malformed body, missing model, voice not configured |
| `401` | no token, or a token Supabase rejected. Carries `signIn: true` so the client can route to login |
| `403` | the session belongs to another candidate |
| `404` | no such session, trace or interview |
| `503` | could not reach Supabase to verify the token. Deliberately not a 401 |

## Conventions

- The browser sends and receives JSON; only audio is base64.
- `frontend/src/lib/utils.js` wraps every call: it attaches the bearer token,
  throws on `ok: false`, and puts the status on the error so a caller can tell
  "sign in" from "gone".
- The server is stateless apart from in-memory sessions, so a restart ends live
  interviews' state. Sessions snapshotted to `sessions/` can be resumed; a
  finished interview survives in Postgres regardless.