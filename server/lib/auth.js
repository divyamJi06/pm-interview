// Who is calling.
//
// The candidate app holds a Supabase session, and this server has to know whose
// session it is serving before it will hand back an interview, spend a call, or
// spend a key. The client says who it is in `userId`, which is a claim, not a
// fact: accepting it would let anyone read anyone else's transcript by editing
// a field.
//
// So the access token is checked against Supabase and the id on the session is
// taken from the answer. Verification is one HTTP call per token per TTL, and
// the result is cached in memory: the token is already in memory everywhere else
// in this process, and re-checking it on every keystroke of a recorded answer
// would be a round trip for nothing.
//
// When Supabase is not configured this stays disabled rather than throwing,
// because a single-user local install has no accounts to check. That is a real
// difference in behaviour and `enforced` reports it, so the routes that depend
// on it can tell an anonymous local caller from an authenticated one.

const DEFAULT_TTL_MS = 60 * 1000;

// Bounded so a long-running server cannot accumulate one entry per token ever
// seen. Eviction is oldest-first, which is fine because these are cheap to
// recompute.
const MAX_CACHE_ENTRIES = 500;

function bearerFrom(req) {
  const raw = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return match ? match[1].trim() : '';
}

// Supabase names the same two values several different ways depending on where
// they were copied from: the dashboard shows a "publishable key", older docs
// show the JWT anon key, and the tutorials are Next.js, so they turn up as
// NEXT_PUBLIC_*. Accept all of them instead of silently booting into
// single-user mode because one variable was spelled differently.
const URL_VARS = [
  'SUPABASE_URL',
  'SUPABASE_PUBLIC_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'VITE_SUPABASE_URL',
];

const KEY_VARS = [
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_PUBLIC_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
];

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}

function createUserVerifier({
  url,
  anonKey,
  fetchImpl = globalThis.fetch,
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now(),
} = {}) {
  // An explicitly passed empty string means "off", not "go read the
  // environment": tests inject empty values to stay disabled whatever the
  // developer's .env says.
  const base = String(typeof url === 'string' ? url : firstEnv(URL_VARS)).replace(/\/+$/, '');
  const key = String(typeof anonKey === 'string' ? anonKey : firstEnv(KEY_VARS));
  const configured = Boolean(base && key);
  const cache = new Map();

  async function check(token) {
    let res;
    try {
      res = await fetchImpl(`${base}/auth/v1/user`, {
        method: 'GET',
        headers: { apikey: key, authorization: `Bearer ${token}` },
      });
    } catch (err) {
      // A network blip reaching Supabase must not take the request down with it.
      // The route already treats anything other than 401/403 as "try again".
      return {
        ok: false,
        status: 503,
        error: 'Could not verify your session. Try again in a moment.',
      };
    }
    if (!res.ok) {
      // 401/403 mean the token is no good. Anything else is our problem talking
      // to Supabase, and must not be read as "signed out", or a Supabase outage
      // would lock every candidate out of their own history.
      const expired = res.status === 401 || res.status === 403;
      return {
        ok: false,
        status: expired ? 401 : 503,
        error: expired
          ? 'Your session has expired. Sign in again to continue.'
          : 'Could not verify your session. Try again in a moment.',
      };
    }
    const user = await res.json();
    const userId = user && user.id;
    if (!userId) return { ok: false, status: 401, error: 'Session did not identify a user.' };
    // `enforced: true` is what the routes read to decide whether ownership is
    // real. Leaving it off here would make ownsSession() and the session list
    // fall back to their unauthenticated behaviour on a deployment that has
    // accounts switched on.
    return { ok: true, userId, email: user.email || '', enforced: true };
  }

  async function verify(token) {
    if (!configured) return { ok: true, userId: null, enforced: false };
    if (!token) return { ok: false, status: 401, error: 'Sign in to continue.' };

    const hit = cache.get(token);
    if (hit && hit.expiresAt > now()) return hit.result;

    const result = await check(token);
    // Only successes are cached: a rejected token may be rejected because
    // Supabase was briefly unreachable, and that should not stick.
    if (result.ok) {
      if (cache.size >= MAX_CACHE_ENTRIES) {
        cache.delete(cache.keys().next().value);
      }
      cache.set(token, { result, expiresAt: now() + ttlMs });
    }
    return result;
  }

  return {
    configured,
    verify,
    // Read by the routes and by /api/health, so an operator can see at a glance
    // whether this deployment is actually checking anyone.
    state: () => ({ configured, enforced: configured, cacheSize: cache.size }),
  };
}

// The id of the session's owner, and whether that owner is allowed to have it.
// A session with no owner predates accounts; under enforcement nobody owns it,
// so it is not served.
function ownsSession(session, auth) {
  if (!auth.enforced) return true;
  if (!session || !session.userId) return false;
  return session.userId === auth.userId;
}

module.exports = { createUserVerifier, bearerFrom, ownsSession, DEFAULT_TTL_MS };
