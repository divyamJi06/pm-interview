const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { once } = require('node:events');

const { createServer } = require('../server/server');
const noAuth = require('./helpers/noAuth');
const { createTranscriber } = require('../server/lib/transcribe');
const { createTraceStore } = require('../server/lib/traceStore');

function fakeFetch(result) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    if (typeof result === 'function') return result(calls.at(-1));
    return result;
  };
  fn.calls = calls;
  return fn;
}

async function boot({ transcriber, traceStore } = {}) {
  const server = createServer({ verifier: noAuth(), transcriber, traceStore });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

function toBase64(body) {
  return Buffer.from(body).toString('base64');
}

async function transcribePost(base, body) {
  const res = await fetch(base + '/api/transcribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('config reports provider, model, language and enabled state', async (t) => {
  const disabled = createTranscriber({ provider: 'deepgram', apiKey: '' });
  const { server, base } = await boot({ transcriber: disabled });
  t.after(() => server.close());

  const res = await fetch(base + '/api/transcribe/config');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(
    { ok: body.ok, enabled: body.enabled, provider: body.provider, model: body.model, language: body.language },
    { ok: true, enabled: false, provider: 'deepgram', model: 'nova-3', language: 'en' }
  );
});

test('config reflects an enabled cohere transcriber', async (t) => {
  const enabled = createTranscriber({ provider: 'cohere', apiKey: 'k', language: 'hi' });
  const { server, base } = await boot({ transcriber: enabled });
  t.after(() => server.close());

  const body = await (await fetch(base + '/api/transcribe/config')).json();
  assert.deepEqual({ enabled: body.enabled, provider: body.provider, language: body.language }, {
    enabled: true,
    provider: 'cohere',
    language: 'hi',
  });
});

test('POST config probe is off without a key and on with one in the body', async (t) => {
  const { server, base } = await boot();
  t.after(() => server.close());

  const none = await (
    await fetch(base + '/api/transcribe/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'cohere' }),
    })
  ).json();
  assert.deepEqual({ ok: none.ok, enabled: none.enabled }, { ok: true, enabled: false });

  const withKey = await (
    await fetch(base + '/api/transcribe/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'cohere', apiKey: 'k' }),
    })
  ).json();
  assert.deepEqual({ ok: withKey.ok, enabled: withKey.enabled, provider: withKey.provider }, {
    ok: true,
    enabled: true,
    provider: 'cohere',
  });
  assert.equal(withKey.byok, false, 'no live session is bound to this key yet');
});

test('config reports an unknown STT_PROVIDER as disabled with the error', async (t) => {
  const { server, base } = await boot();
  t.after(() => server.close());

  const original = process.env.STT_PROVIDER;
  process.env.STT_PROVIDER = 'bogus';
  try {
    const body = await (await fetch(base + '/api/transcribe/config')).json();
    assert.equal(body.ok, false);
    assert.equal(body.enabled, false);
    assert.match(body.error, /Unknown STT_PROVIDER 'bogus'/);
  } finally {
    if (original !== undefined) process.env.STT_PROVIDER = original;
    else delete process.env.STT_PROVIDER;
  }
});

test('POST /api/transcribe returns 503 when no provider key is configured', async (t) => {
  const disabled = createTranscriber({ provider: 'deepgram', apiKey: '' });
  const { server, base } = await boot({ transcriber: disabled });
  t.after(() => server.close());

  const res = await transcribePost(base, { sessionId: 's1', audio: toBase64('audio') });
  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /Voice input is off in this deployment/);
});

test('POST /api/transcribe transcribes base64 audio and returns transcript', async (t) => {
  const fetchImpl = fakeFetch(
    new Response(
      JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: 'Speak your answer aloud.' }] }] } }),
      { status: 200 }
    )
  );
  const enabled = createTranscriber({ provider: 'deepgram', apiKey: 'k', fetchImpl });
  const { server, base } = await boot({ transcriber: enabled });
  t.after(() => server.close());

  const res = await transcribePost(base, {
    sessionId: 's1',
    audio: toBase64('fake-webm-bytes'),
    contentType: 'audio/webm;codecs=opus',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.transcript, 'Speak your answer aloud.');

  assert.equal(fetchImpl.calls.length, 1);
  const sent = fetchImpl.calls[0];
  assert.equal(sent.opts.headers.authorization, 'Token k');
  assert.equal(sent.opts.headers['content-type'], 'audio/webm', 'codec params stripped before forwarding');
  assert.deepEqual(sent.opts.body, Buffer.from('fake-webm-bytes'));
});

test('cohere format gate errors from the endpoint as a 400', async (t) => {
  const fetchImpl = fakeFetch(() => {
    throw new Error('should not be called');
  });
  const enabled = createTranscriber({ provider: 'cohere', apiKey: 'k', fetchImpl });
  const { server, base } = await boot({ transcriber: enabled });
  t.after(() => server.close());

  const res = await transcribePost(base, {
    sessionId: 's1',
    audio: toBase64('webm-bytes'),
    contentType: 'audio/webm',
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /does not accept audio\/webm/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('POST /api/transcribe returns 400 for empty audio', async (t) => {
  const fetchImpl = fakeFetch(() => {
    throw new Error('should not be called');
  });
  const enabled = createTranscriber({ provider: 'openai', apiKey: 'k', fetchImpl });
  const { server, base } = await boot({ transcriber: enabled });
  t.after(() => server.close());

  const res = await transcribePost(base, { sessionId: 's1', audio: '', contentType: 'audio/webm' });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test('POST /api/transcribe surfaces upstream failures as 502', async (t) => {
  const fetchImpl = fakeFetch(new Response(JSON.stringify({}), { status: 500 }));
  const enabled = createTranscriber({ provider: 'deepgram', apiKey: 'k', fetchImpl });
  const { server, base } = await boot({ transcriber: enabled });
  t.after(() => server.close());

  const res = await transcribePost(base, { sessionId: 's1', audio: toBase64('audio') });
  assert.equal(res.status, 502);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /Deepgram STT responded 500/);
});

test('successful transcription is traced as an stt row with a cost', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-trace-'));
  const traceStore = createTraceStore({ rootDir: root });
  const fetchImpl = fakeFetch(
    new Response(
      JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: 'traced' }] }] } }),
      { status: 200 }
    )
  );
  const enabled = createTranscriber({ provider: 'deepgram', apiKey: 'k', fetchImpl });
  const { server, base } = await boot({ transcriber: enabled, traceStore });
  t.after(() => server.close());

  const res = await transcribePost(base, {
    sessionId: 'voice-session',
    audio: toBase64(Buffer.alloc(Math.round(60 * 48000 / 8))),
    contentType: 'audio/webm',
  });
  assert.equal(res.status, 200);

  const callsDir = path.join(root, 'voice-session', 'calls');
  const files = fs.readdirSync(callsDir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 1);
  const call = JSON.parse(fs.readFileSync(path.join(callsDir, files[0]), 'utf8'));
  assert.equal(call.label, 'stt');
  assert.equal(call.success, true);
  assert.equal(call.provider, 'deepgram');
  assert.ok(call.costUsd != null && call.costUsd > 0, 'stt cost recorded');
});

test('no trace is written when sessionId is absent', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-notrace-'));
  const traceStore = createTraceStore({ rootDir: root });
  const fetchImpl = fakeFetch(
    new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: 'x' }] }] } }), {
      status: 200,
    })
  );
  const enabled = createTranscriber({ provider: 'deepgram', apiKey: 'k', fetchImpl });
  const { server, base } = await boot({ transcriber: enabled, traceStore });
  t.after(() => server.close());

  const res = await transcribePost(base, { audio: toBase64('audio') });
  assert.equal(res.status, 200);
  assert.equal(fs.readdirSync(root).filter((f) => f.endsWith('.json')).length, 0);
});