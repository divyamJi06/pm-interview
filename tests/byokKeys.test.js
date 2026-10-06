const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

const { createServer } = require('../server/server');
const noAuth = require('./helpers/noAuth');
const { loadStageOrder } = require('../server/config/stageOrder');
const store = require('../server/lib/sessionStore');
const { createTranscriber } = require('../server/lib/transcribe');

// Bring-your-own-key and per-candidate session ownership.
//
// The engine used to read one COHERE_API_KEY from .env and share it with
// everyone. It now takes the candidate's key with the request that needs it, and
// the tests here pin the three properties that matter: the supplied key is the
// one used, it never reaches the persisted session, and a session list can be
// narrowed to one candidate.

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

// Takes the test context so it can guarantee teardown: a listening server left
// behind keeps the run alive forever, and three of these tests do not otherwise
// need a handle on it.
async function boot(t, { transcriberFactory } = {}) {
  const mock = makeMockCallModel();
  const seen = [];
  const factory = (opts) => {
    seen.push(opts);
    return mock.callModel;
  };
  const server = createServer({
    verifier: noAuth(),
    callModel: mock.callModel,
    callModelFactory: factory,
    transcriberFactory,
    config: loadStageOrder(),
    rng: () => 0,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => close(server));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, seen };
}

function close(server) {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });
}

async function post(base, p, body) {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(base, p) {
  const res = await fetch(base + p);
  return { status: res.status, body: await res.json() };
}

test('a supplied Cohere key is used for the interview, on cohere', async (t) => {
  const { base, seen } = await boot(t);

  const res = await post(base, '/api/start', {
    mode: 'practice',
    stage: 'estimation',
    apiKey: 'candidate-key-123',
    sttApiKey: 'candidate-key-123',
    userId: 'user-a',
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.sessionId);

  assert.ok(seen.length >= 1, 'a model was built from the supplied key');
  for (const opts of seen) {
    assert.equal(opts.provider, 'cohere');
    assert.equal(opts.apiKey, 'candidate-key-123');
  }
});

test('the supplied key is never written into the session', async (t) => {
  const { base } = await boot(t);

  const res = await post(base, '/api/start', {
    mode: 'practice',
    stage: 'estimation',
    apiKey: 'candidate-key-123',
    userId: 'user-a',
  });
  const session = store.getSession(res.body.sessionId);
  assert.ok(session);
  const serialised = JSON.stringify(store.serializeSession(session));
  assert.equal(serialised.includes('candidate-key-123'), false, 'session must not carry the key');
  // And the response must not echo it back either.
  assert.equal(JSON.stringify(res.body).includes('candidate-key-123'), false);
});

test('answers to a keyed session reuse that key rather than the server default', async (t) => {
  const { base, seen } = await boot(t);

  const started = await post(base, '/api/start', {
    mode: 'practice',
    stage: 'estimation',
    apiKey: 'candidate-key-123',
    userId: 'user-a',
  });
  const before = seen.length;
  await post(base, '/api/answer', { sessionId: started.body.sessionId, answer: 'Roughly a hundred million users.' });
  assert.ok(seen.length > before, 'the answer built another model');
  for (const opts of seen.slice(before)) {
    assert.equal(opts.apiKey, 'candidate-key-123');
  }
});

test('no key means the server default is used and nothing is remembered', async (t) => {
  const { base, seen } = await boot(t);

  const res = await post(base, '/api/start', {
    mode: 'practice',
    stage: 'estimation',
    userId: 'user-a',
  });
  assert.equal(res.status, 200);
  assert.equal(seen.length, 0, 'no per-session model is built without a key');
  assert.equal(store.getSession(res.body.sessionId).userId, 'user-a');
});

test('a session carries the id of the candidate who started it', async (t) => {
  const { base } = await boot(t);

  const a = await post(base, '/api/start', { mode: 'practice', stage: 'estimation', userId: 'user-a' });
  const b = await post(base, '/api/start', { mode: 'practice', stage: 'estimation', userId: 'user-b' });

  assert.equal(store.getSession(a.body.sessionId).userId, 'user-a');
  assert.equal(store.getSession(b.body.sessionId).userId, 'user-b');

  const mine = await get(base, '/api/sessions?userId=user-a');
  const ids = mine.body.sessions.map((s) => s.sessionId);
  assert.ok(ids.includes(a.body.sessionId));
  assert.equal(ids.includes(b.body.sessionId), false);

  const everyone = await get(base, '/api/sessions');
  assert.ok(everyone.body.sessions.length >= 2);
});

test('a blank key is treated as no key', async (t) => {
  const { base, seen } = await boot(t);

  const res = await post(base, '/api/start', {
    mode: 'practice',
    stage: 'estimation',
    apiKey: '   ',
    sttApiKey: '',
    userId: 'user-a',
  });
  assert.equal(res.status, 200);
  assert.equal(seen.length, 0);
});

test('transcription uses the key held against the session', async (t) => {
  const sent = [];
  const fetchImpl = async (url, opts) => {
    sent.push({ url, opts });
    return new Response(JSON.stringify({ text: 'sized it from the bottom up' }), { status: 200 });
  };
  // No base transcriber is injected: the per-request one is what has to pick up
  // the key from the session, which is the path a real candidate takes.
  const transcriberFactory = (opts) => {
    sent.factory = opts;
    return createTranscriber({ ...opts, fetchImpl });
  };
  const { base } = await boot(t, { transcriberFactory });

  const started = await post(base, '/api/start', {
    mode: 'practice',
    stage: 'estimation',
    apiKey: 'candidate-key-123',
    sttApiKey: 'speech-key-456',
    userId: 'user-a',
  });
  assert.equal(started.status, 200);

  const res = await post(base, '/api/transcribe', {
    sessionId: started.body.sessionId,
    // A wav, because Cohere rejects Chrome's webm and the client converts first.
    audio: Buffer.from('riff').toString('base64'),
    contentType: 'audio/wav',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.transcript, 'sized it from the bottom up');
  assert.equal(sent.factory.provider, 'cohere');
  assert.equal(sent.factory.apiKey, 'speech-key-456');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].opts.headers.authorization, 'Bearer speech-key-456');
});

test('a speech key sent with the recording wins over the one held for the session', async (t) => {
  const fetchImpl = async () => new Response(JSON.stringify({ text: 'fresh key used' }), { status: 200 });
  let built = null;
  const { base } = await boot(t, {
    transcriberFactory: (opts) => {
      built = opts;
      return createTranscriber({ ...opts, fetchImpl });
    },
  });

  const started = await post(base, '/api/start', {
    mode: 'practice',
    stage: 'estimation',
    apiKey: 'llm-key',
    sttApiKey: 'speech-key-456',
  });

  const res = await post(base, '/api/transcribe', {
    sessionId: started.body.sessionId,
    apiKey: 'speech-key-789',
    audio: Buffer.from('riff').toString('base64'),
    contentType: 'audio/wav',
  });
  assert.equal(res.status, 200);
  assert.equal(built.apiKey, 'speech-key-789');
});

test('transcription without any key is refused rather than sent upstream unauthenticated', async (t) => {
  // This developer's machine has a real .env, and the transcriber falls back to
  // it. Clear the environment so "no key" actually means no key.
  const saved = {};
  for (const name of ['STT_PROVIDER', 'DEEPGRAM_API_KEY', 'COHERE_API_KEY', 'OPENAI_API_KEY']) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value !== undefined) process.env[name] = value;
      else delete process.env[name];
    }
  });

  let upstream = 0;
  const built = [];
  const { base } = await boot(t, {
    transcriberFactory: (opts) => {
      built.push(opts);
      return createTranscriber({
        ...opts,
        fetchImpl: async () => {
          upstream += 1;
          return new Response('{}', { status: 200 });
        },
      });
    },
  });
  const res = await post(base, '/api/transcribe', {
    sessionId: 'never-started',
    audio: Buffer.from('riff').toString('base64'),
    contentType: 'audio/wav',
  });
  assert.equal(res.status, 503);
  assert.equal(upstream, 0, 'nothing may be sent upstream without a key');
  assert.equal(built.at(-1).apiKey, undefined, 'and no key is invented for it');
});

test('the transcribe config reports cohere when the client says it is on cohere', async (t) => {
  const { base } = await boot(t);

  const body = (await get(base, '/api/transcribe/config?provider=cohere')).body;
  assert.equal(body.provider, 'cohere');
  assert.equal(body.model, 'cohere-transcribe-03-2026');
});

test('an unknown speech provider falls back instead of being forwarded', async (t) => {
  const { base } = await boot(t);

  const body = (await get(base, '/api/transcribe/config?provider=bogus')).body;
  assert.notEqual(body.provider, 'bogus');
});

