const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

const { createServer } = require('../server/server');
const { createUserVerifier, ownsSession, bearerFrom } = require('../server/lib/auth');
const { loadStageOrder } = require('../server/config/stageOrder');
const store = require('../server/lib/sessionStore');

// Enforced auth: the properties that only matter once accounts are switched on.
//
// Every other test in this suite injects tests/helpers/noAuth.js, which is
// deliberately open. That is the right default for testing the interview engine,
// and it also means nothing else here would notice if enforcement quietly stopped
// working — which is exactly the failure this file exists to catch. A candidate
// reading another candidate's transcript is not a bug anyone notices by clicking
// around; it has to be pinned by a test or it is invisible.

function makeMockCallModel() {
  return {
    callModel(prompt) {
      if (prompt.includes('You are routing messages')) return { type: 'answer' };
      if (prompt.includes('You are the interviewer in a PM mock interview')) {
        return { question: 'How would you size this market?' };
      }
      if (prompt.includes('You are grading a candidate')) {
        return {
          dimension_scores: { quality: 4 },
          green_flags_hit: [],
          red_flags_hit: [],
          summary: 'Fine.',
          overall_verdict: 'strong',
          updated_profile: [],
        };
      }
      if (prompt.includes('writing a stage-level verdict')) {
        return { stage_verdict: 'strong', summary: 'Fine.', strengths: [], gaps: [] };
      }
      if (prompt.includes('deciding what happens next')) {
        return { decision: 'next_stage', reasoning: 'scripted' };
      }
      throw new Error('unexpected prompt: ' + prompt.slice(0, 200));
    },
  };
}

// A verifier that behaves like the real one with Supabase configured: it maps a
// token to a user id and marks the result enforced, which is the flag every route
// reads to decide whether ownership counts.
function enforcingVerifier(users) {
  return {
    configured: true,
    async verify(token) {
      const userId = users[token || ''];
      if (!userId) return { ok: false, status: 401, error: 'Sign in to continue.' };
      return { ok: true, userId, email: `${userId}@example.com`, enforced: true };
    },
    state: () => ({ configured: true, enforced: true, cacheSize: 0 }),
  };
}

async function boot(t, users = { 'token-a': 'user-a', 'token-b': 'user-b' }) {
  const mock = makeMockCallModel();
  // The session store is a module-level singleton, so sessions started by an
  // earlier test in this file would otherwise show up in this one's session list
  // and make an ownership assertion pass or fail for the wrong reason.
  store.clearSessions();
  const server = createServer({
    verifier: enforcingVerifier(users),
    callModel: mock.callModel,
    config: loadStageOrder(),
    rng: () => 0,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => close(server));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

function close(server) {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });
}

async function post(base, p, body, token) {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(base, p, token) {
  const res = await fetch(base + p, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: await res.json() };
}

test('a successful verification reports itself as enforced', async () => {
  // The one that matters most. ownsSession() and the session list both branch on
  // this flag, and a verifier that returned a bare { ok, userId } would leave a
  // deployment with accounts switched on behaving exactly like an open one.
  const verifier = createUserVerifier({
    url: 'https://project.supabase.co',
    anonKey: 'anon-test',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'user-1', email: 'a@example.com' }),
    }),
  });

  const result = await verifier.verify('a-real-token');

  assert.equal(result.ok, true);
  assert.equal(result.userId, 'user-1');
  assert.equal(result.enforced, true);
});

test('an unconfigured verifier reports enforcement off', async () => {
  const verifier = createUserVerifier({ url: '', anonKey: '' });

  const result = await verifier.verify('');

  assert.deepEqual(result, { ok: true, userId: null, enforced: false });
  assert.deepEqual(verifier.state(), { configured: false, enforced: false, cacheSize: 0 });
});

test('ownsSession trusts nobody when enforcement is off, and only the owner when on', () => {
  const session = { id: 's1', userId: 'user-a' };

  assert.equal(ownsSession(session, { ok: true, userId: 'user-b', enforced: false }), true);
  assert.equal(ownsSession(session, { ok: true, userId: 'user-a', enforced: true }), true);
  assert.equal(ownsSession(session, { ok: true, userId: 'user-b', enforced: true }), false);
  // A session with no owner predates accounts, so under enforcement nobody owns it.
  assert.equal(ownsSession({ id: 's2' }, { ok: true, userId: 'user-a', enforced: true }), false);
  assert.equal(ownsSession(null, { ok: true, userId: 'user-a', enforced: true }), false);
});

test('bearerFrom reads the header case-insensitively and rejects anything else', () => {
  assert.equal(bearerFrom({ headers: { authorization: 'Bearer abc' } }), 'abc');
  assert.equal(bearerFrom({ headers: { Authorization: 'bearer  xyz ' } }), 'xyz');
  assert.equal(bearerFrom({ headers: {} }), '');
  assert.equal(bearerFrom({ headers: { authorization: 'Basic abc' } }), '');
  assert.equal(bearerFrom(null), '');
});

test('every api route refuses an anonymous caller once auth is on', async (t) => {
  const base = await boot(t);

  const started = await post(base, '/api/start', { mode: 'practice', stage: 'estimation' });

  assert.equal(started.status, 401);
  assert.equal(started.body.ok, false);
  assert.equal(started.body.signIn, true);

  for (const path of ['/api/sessions', '/api/candidates', '/api/tts/config', '/api/traces']) {
    const res = await get(base, path);
    assert.equal(res.status, 401, `${path} should require a token`);
  }
});

test('the public surface stays reachable without a session', async (t) => {
  const base = await boot(t);

  // The landing page has to load for someone who is not signed in yet, and the
  // setup wizard cannot ask who you are before it knows.
  for (const path of ['/', '/api/health', '/api/stages', '/api/tracks']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, `${path} should be public`);
  }
});

test('a start request is stamped with the verified user, not the claimed one', async (t) => {
  const base = await boot(t);

  // userId in the body is a claim. The token is the fact.
  const res = await post(
    base,
    '/api/start',
    { mode: 'practice', stage: 'estimation', userId: 'user-b' },
    'token-a',
  );

  assert.equal(res.status, 200);
  assert.equal(store.getSession(res.body.sessionId).userId, 'user-a');
});

test('the session list ignores userId in the query string', async (t) => {
  const base = await boot(t);

  const a = await post(base, '/api/start', { mode: 'practice', stage: 'estimation' }, 'token-a');
  const b = await post(base, '/api/start', { mode: 'practice', stage: 'estimation' }, 'token-b');

  const mine = await get(base, '/api/sessions', 'token-a');
  assert.deepEqual(
    mine.body.sessions.map((s) => s.sessionId),
    [a.body.sessionId],
  );

  // Asking for somebody else's id in the query string changes nothing.
  const spoofed = await get(base, '/api/sessions?userId=user-b', 'token-a');
  assert.deepEqual(
    spoofed.body.sessions.map((s) => s.sessionId),
    [a.body.sessionId],
  );

  const theirs = await get(base, '/api/sessions', 'token-b');
  assert.deepEqual(
    theirs.body.sessions.map((s) => s.sessionId),
    [b.body.sessionId],
  );
});

test('another candidate cannot resume, answer into, or read a session', async (t) => {
  const base = await boot(t);

  const started = await post(base, '/api/start', { mode: 'practice', stage: 'estimation' }, 'token-a');
  const sessionId = started.body.sessionId;

  const resume = await get(base, `/api/sessions/${sessionId}`, 'token-b');
  assert.equal(resume.status, 403);
  assert.match(resume.body.error, /another candidate/);

  const answer = await post(base, '/api/answer', { sessionId, answer: 'Their answer.' }, 'token-b');
  assert.equal(answer.status, 403);

  const report = await get(base, `/api/report/${sessionId}`, 'token-b');
  assert.equal(report.status, 403);

  // The owner is still fine, which is the other half of the property.
  const owner = await get(base, `/api/sessions/${sessionId}`, 'token-a');
  assert.equal(owner.status, 200);
});

test('another candidate cannot transcribe against a session they do not own', async (t) => {
  const base = await boot(t);

  const started = await post(base, '/api/start', { mode: 'practice', stage: 'estimation' }, 'token-a');

  const res = await post(
    base,
    '/api/transcribe',
    { sessionId: started.body.sessionId, audio: 'AAAA', contentType: 'audio/webm' },
    'token-b',
  );

  assert.equal(res.status, 403);
});

test('an unknown token is a 401 with a sign-in hint, not a 500', async (t) => {
  const base = await boot(t);

  const res = await get(base, '/api/sessions', 'token-that-was-never-issued');

  assert.equal(res.status, 401);
  assert.equal(res.body.signIn, true);
});