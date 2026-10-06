# Accounts, data and access control

What changed on this branch: the app went from a single-user local tool to one
where each candidate has an account, their own history, and their own keys.
Supabase owns identity and the durable records; the Node server owns the
interview engine and only ever serves a session to the person it belongs to.

Nothing here is required. With no Supabase configuration the app still runs, in
single-user mode on localhost. Accounts switch on the moment the server can see
a Supabase URL and key.

## The two modes

| | no Supabase env | Supabase env set |
|---|---|---|
| `/api/health` `auth` | `{configured: false, enforced: false}` | `{configured: true, enforced: true}` |
| `/api/*` | open, no token needed | `Authorization: Bearer <supabase access token>` required, else `401` |
| `GET /api/sessions?userId=x` | honoured, it is the only way to narrow the list | ignored, the token decides |
| session ownership | not checked | session `userId` must equal the verified user id |
| frontend history | no rows, dashboard shows nothing | the candidate's own rows from Postgres |
| intended for | local development | anything reachable by another machine |

`enforced` is reported by `/api/health` precisely so an operator can tell at a
glance whether a deployment is actually checking anyone. A deployment that
believes it has accounts and reports `enforced: false` is misconfigured.

## Setup

1. Create a Supabase project.
2. Run `supabase/migrations/001_init.sql` once, in the SQL editor or with
   `supabase db push`. It is safe to re-run: every object uses
   `IF NOT EXISTS` / `OR REPLACE`, and policies and triggers are dropped first.
3. Put the project URL and anon key in two places.

   `frontend/.env` (or `frontend/.env.local`) — read by Vite, and therefore
   public:

   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_...   # or the older JWT anon key
   ```

   `.env` in the project root — read by the Node server, and used to verify
   tokens:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

The server accepts any of the names Supabase is handed out under, so
`SUPABASE_URL` / `SUPABASE_ANON_KEY` work identically to the `NEXT_PUBLIC_`
pair above. See `server/lib/auth.js` for the full list.

Both `.env` files are gitignored. The anon key is designed to be public — row
level security is what keeps candidates apart — but never put the
`service_role` key in either file, and never in anything under `frontend/`.

## The schema

Four tables were considered; three ship. All are keyed to `auth.users(id)`, all
have row level security on.

### `profiles`

One row per signed-in candidate, created by a trigger on `auth.users` insert so
the app never races its own first read.

| column | notes |
|---|---|
| `id` | primary key, `references auth.users(id) on delete cascade` |
| `full_name`, `phone`, `email` | contact details, editable |
| `target_role` | "Senior PM", "Product Lead" — fed to the interviewer |
| `years_experience` | numeric, nullable |
| `resume_text` | first 8000 characters of the pasted resume; the engine truncates at the same limit |
| `resume_file_name` | original filename, shown in the UI |
| `onboarding_complete` | gates the app: false routes the candidate into onboarding |
| `created_at`, `updated_at` | `updated_at` maintained by the `profiles_touch_updated_at` trigger |

### `interviews`

One row per interview, written the moment the engine accepts `/api/start`, so
an abandoned run still appears in the history as `live` instead of vanishing.

| column | notes |
|---|---|
| `session_id` | the id minted by the Node engine. Join key back to `/api/report/:sessionId` while a run is in flight |
| `mode` | `mock` or `practice` |
| `stage` | one of the seven gradeable stages, or null for a full mock |
| `status` | `live`, `completed`, `abandoned` |
| `feedback_mode` | `full` or `simulation` |
| `voice_mode` | whether the run used speech input |
| `question_count`, `answer_count` | denominators for the history list |
| `overall_score` | 0-100 from the engine's `scores.overall` |
| `stage_scores` | jsonb, e.g. `{"product_thinking": 72, "execution": 65}` |
| `strongest_dimension`, `weakest_dimension` | denormalised so the dashboard can sort without opening every report |

Indexes: `(user_id, started_at desc)` for the history query, and a unique
`(user_id, session_id)` so re-joining a run updates one row instead of creating
a second entry.

### `interview_reports`

The finished engine payload, stored as jsonb because its shape changes with the
prompts while `interviews` keeps the handful of numbers the dashboard actually
queries. Unique on `interview_id`.

### What is not stored: provider keys

A candidate's Cohere key is not in the database, and no table for it exists.
`001_init.sql` has no `api_keys`; `002_drop_api_keys.sql` removes it from
projects created from the earlier draft.

Keys live in `localStorage` and are sent per request to the interview server,
which holds them in memory for one round. See [keys.md](keys.md) for the full
list of what is and is not persisted.

## Row level security

Every table has one policy, scoped to the owner:

```sql
create policy "interviews are self-service" on public.interviews
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

`profiles` matches on `id`; the other two on `user_id`. `with check` is what
stops a candidate writing a row that belongs to somebody else.

Consequence worth knowing: the browser queries these tables **without** a
`userId` filter, on purpose. RLS is the filter. Adding a client-side filter as
well would mean a bug in that filter shows an empty history instead of an error,
which is much harder to notice.

## How a request is authenticated

```
browser                     Node server                  Supabase
  |  api() adds Bearer         |                          |
  |-------------------------->|                          |
  |                           | GET /auth/v1/user        |
  |                           |------------------------->|
  |                           |   { id, email }          |
  |                           |<-------------------------|
  |                           | cache result 60s         |
  |                           |                          |
  |                           | serve only if            |
  |                           | session.userId === id    |
```

- The token is the Supabase access token from `supabase.auth.getSession()`.
  `frontend/src/app/authContext.jsx` publishes it to
  `frontend/src/lib/utils.js`, which attaches it to every `api()` call. A new
  call site cannot forget it.
- Verification is one HTTP call per token per TTL, cached in memory
  (`server/lib/auth.js`). Only successes are cached: a rejection may be a
  Supabase outage, and caching that would lock candidates out of their own
  history.
- A 401 or 403 from Supabase means the token is bad and the answer is 401.
  Anything else is a 503, never "signed out" — see the comment at
  `server/lib/auth.js:84`.
- On sign-out the token is cleared. A stale token would keep answering requests
  after the account that owned it had gone.

### Why the token, and not the body's `userId`

`POST /api/start` still accepts a `userId` field, and in single-user mode that
field is the owner. Under enforcement it is ignored: the session is stamped with
the id from the verified token (`server/server.js:365`). A `userId` in a request
body is a claim; the token is a fact. `tests/auth.enforcement.test.js` pins this.

### What is checked per route

| route | check |
|---|---|
| `GET /api/sessions` | filtered by the verified id; `?userId=` ignored |
| `GET /api/sessions/:id` | 403 unless the session belongs to the caller |
| `GET /api/report/:id` | 403 unless the session belongs to the caller |
| `POST /api/answer` | 403 unless the session belongs to the caller |
| `POST /api/transcribe` | 403 when the request names a session the caller does not own |
| `POST /api/start` | stamped with the verified id |
| `POST /api/candidates`, `GET /api/candidates*` | token required, but **not** scoped per user |
| `GET /api/traces`, `GET /api/traces/:name` | token required, but **not** scoped per user |

The last two rows are known gaps, not oversights to copy: candidates and traces
are file-backed and shared by the single Node process, so under multi-user use
one candidate can currently see another's candidate profiles and trace
reconstructions. Before putting this on a network, scope both by owner — either
add `user_id` to the file records or move them behind the same per-user check the
sessions use.

A session with no `userId` predates accounts. Under enforcement nobody owns it,
so it is not served (`ownsSession` in `server/lib/auth.js:133`).

## Signup and email confirmation

`signUp` in `authContext.jsx` handles both shapes. With email confirmation on,
Supabase returns a user and no session, so the app reports `needsConfirmation`
and stops there. Otherwise it writes the profile row in the same pass, which is
why signup collects the whole profile in one form rather than creating a row and
then updating it.

## Disabling accounts again

Remove or comment the two Supabase lines from `.env` and restart. `/api/health`
should report `enforced: false`. History stops loading because the frontend has
no project to read, but the engine, transcripts on disk and traces all keep
working.