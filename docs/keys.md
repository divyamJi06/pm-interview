# Bring your own key

Every interview costs model calls, so this app asks for a Cohere key instead of
shipping one. That key is the candidate's own credential, and the rule this
branch settled on is simple:

> The key lives in the browser. We keep no copy, anywhere.

## Where the key lives

| place | what happens |
|---|---|
| `localStorage`, key `pm-key:llm` | the interview model key |
| `localStorage`, key `pm-key:stt` | the speech-to-text key |
| the interview server | receives it per request, holds it in memory for that session, forgets it when the process restarts |
| the database | never. There is no table for it |

Written by `frontend/src/lib/apiKeys.js`, read by
`frontend/src/app/authContext.jsx`, sent in the body of `POST /api/start` and
`POST /api/transcribe`. The server copies it into the per-session model factory
(`rememberSessionKeys` in `server/server.js:77`) and never logs it.

Two keys, because they are optional and independent: `llm` drives the
interviewer's questions, `stt` transcribes spoken answers. With no key at all,
the server falls back to whatever `COHERE_API_KEY` is in its own environment, if
one is set there. A blank string counts as no key.

## Why there is no "remember on my account"

An earlier draft had an opt-in sync to an `api_keys` table, with the checkbox
and a warning about plaintext. It is gone, deliberately:

- A row in the database is a live third-party credential readable by anyone with
  database access, and it is duplicated into backups and point-in-time restores
  that nobody reviews.
- RLS keeps other candidates out, but RLS is not the threat model here. The
  threat is us, a mistake, and a leak.
- The candidate can revoke a key with Cohere. A plaintext copy in our database
  does not get revoked with it.

The cost is that practising on a second device means pasting the key again. That
is the right trade.

## Consequences to know

- **Clearing site data deletes the key.** There is no recovery. The candidate
  pastes it again.
- **A shared machine shares the key**, because localStorage is per browser
  profile, not per person. Worth saying out loud in a public or lab setting.
- **Keys are not encrypted at rest in the browser.** localStorage is readable by
  anything with script access on that origin. Session storage would be tighter
  but would not survive a refresh mid-interview, which is the one moment it
  matters.
- **The interview server sees the key in memory** for the round. That is the
  point of a proxy, and it is why the server has no key persistence: nothing
  survives a restart.

## What we store about a candidate, and what we do not

Only the rows in [accounts.md](accounts.md#the-schema) reach Postgres. To be
explicit about the things people usually worry about:

| | stored | where |
|---|---|---|
| email, name, phone | yes | `profiles`, so the interviewer can address them |
| target role, years of experience | yes | `profiles`, fed to the prompt |
| resume text (first 8000 chars) | yes | `profiles` |
| interview history and reports | yes | `interviews`, `interview_reports` |
| Cohere keys | **no** | browser localStorage only |
| interview audio | **no** | transcription is transient; no audio is stored |
| camera / video recording | **no** | not implemented on this branch |
| raw prompts and outputs | yes | `traces/` on the server disk, per run |
| IP address, user agent | yes, unavoidably | Supabase auth logs, provider logs |

## Deleting a candidate's data

- **Account**: delete the user in Supabase. The trigger cascades, so
  `profiles`, `interviews` and `interview_reports` go with it.
- **Traces and session snapshots**: files on the server disk under `traces/` and
  `sessions/`. There is no UI for this; it is a filesystem task.
- **Key**: the candidate clears site data, or presses Forget in
  `/app/profile`. Nothing is stored for us to delete.