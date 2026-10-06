const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { once } = require('node:events');

const { createServer } = require('../server/server');
const noAuth = require('./helpers/noAuth');
const { createSpeaker } = require('../server/lib/speech');
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

function audioResponse(body, contentType = 'audio/mpeg') {
  const res = new Response(body, { status: 200 });
  res.headers.set('content-type', contentType);
  return res;
}

async function boot({ speaker, traceStore } = {}) {
  const server = createServer({ verifier: noAuth(), speaker, traceStore });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function ttsPost(base, body) {
  const res = await fetch(base + '/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function withProvider(provider, fn) {
  const original = process.env.TTS_PROVIDER;
  process.env.TTS_PROVIDER = provider;
  try {
    return await fn();
  } finally {
    if (original !== undefined) process.env.TTS_PROVIDER = original;
    else delete process.env.TTS_PROVIDER;
  }
}

async function withoutProvider(fn) {
  const original = process.env.TTS_PROVIDER;
  delete process.env.TTS_PROVIDER;
  try {
    return await fn();
  } finally {
    if (original !== undefined) process.env.TTS_PROVIDER = original;
    else delete process.env.TTS_PROVIDER;
  }
}

test('GET /api/tts/config reports the configured speaker and engine when opted in', async (t) => {
  const enabled = createSpeaker({ provider: 'deepgram', apiKey: 'k' });
  const { server, base } = await boot({ speaker: enabled });
  t.after(() => server.close());

  await withProvider('deepgram', async () => {
    const body = await (await fetch(base + '/api/tts/config')).json();
    assert.equal(body.ok, true);
    assert.equal(body.enabled, true);
    assert.equal(body.provider, 'deepgram');
    assert.equal(body.model, 'aura-2-en-default');
    assert.equal(body.voice, 'aura-2-en-default');
    assert.equal(body.engine, 'server');
    assert.ok(body.maxTextChars > 0);
  });
});

test('GET /api/tts/config reports browser engine when no key is set', async (t) => {
  const disabled = createSpeaker({ provider: 'deepgram', apiKey: '' });
  const { server, base } = await boot({ speaker: disabled });
  t.after(() => server.close());

  const body = await (await fetch(base + '/api/tts/config')).json();
  assert.equal(body.ok, true);
  assert.equal(body.enabled, false);
  assert.equal(body.engine, 'browser');
});

test('GET /api/tts/config reports browser engine even with a key unless TTS_PROVIDER opts in', async (t) => {
  const enabled = createSpeaker({ provider: 'deepgram', apiKey: 'k' });
  const { server, base } = await boot({ speaker: enabled });
  t.after(() => server.close());

  await withoutProvider(async () => {
    const body = await (await fetch(base + '/api/tts/config')).json();
    assert.equal(body.enabled, true, 'key present so the speaker is usable');
    assert.equal(body.engine, 'browser', 'no TTS_PROVIDER set, so the browser speaks by default');
  });
});

test('GET /api/tts/config reports an unknown TTS_PROVIDER as browser with the error', async (t) => {
  const { server, base } = await boot();
  t.after(() => server.close());

  const original = process.env.TTS_PROVIDER;
  process.env.TTS_PROVIDER = 'bogus';
  try {
    const body = await (await fetch(base + '/api/tts/config')).json();
    assert.equal(body.ok, false);
    assert.equal(body.engine, 'browser');
    assert.match(body.error, /Unknown TTS_PROVIDER 'bogus'/);
  } finally {
    if (original !== undefined) process.env.TTS_PROVIDER = original;
    else delete process.env.TTS_PROVIDER;
  }
});

test('POST /api/tts returns 503 when no provider key is configured', async (t) => {
  const disabled = createSpeaker({ provider: 'openai', apiKey: '' });
  const { server, base } = await boot({ speaker: disabled });
  t.after(() => server.close());

  const res = await ttsPost(base, { text: 'Hello' });
  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /OPENAI_API_KEY/);
});

test('POST /api/tts returns 503 unless TTS_PROVIDER opts in, even with a key', async (t) => {
  const enabled = createSpeaker({ provider: 'openai', apiKey: 'k' });
  const { server, base } = await boot({ speaker: enabled });
  t.after(() => server.close());

  await withoutProvider(async () => {
    const res = await ttsPost(base, { text: 'Hello' });
    assert.equal(res.status, 503);
    assert.match(res.body.error, /TTS_PROVIDER/);
  });
});

test('POST /api/tts rejects empty text', async (t) => {
  const fetchImpl = fakeFetch(() => {
    throw new Error('should not be called');
  });
  const enabled = createSpeaker({ provider: 'openai', apiKey: 'k', fetchImpl });
  const { server, base } = await boot({ speaker: enabled });
  t.after(() => server.close());

  await withProvider('openai', async () => {
    for (const text of ['', '   ', undefined]) {
      const res = await ttsPost(base, { text });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /Nothing to speak/);
    }
    assert.equal(fetchImpl.calls.length, 0);
  });
});

test('POST /api/tts synthesizes audio and returns it base64 with the content type', async (t) => {
  const audioBytes = Buffer.from('fake-mp3-bytes');
  const fetchImpl = fakeFetch(audioResponse(audioBytes, 'audio/mpeg'));
  const enabled = createSpeaker({ provider: 'openai', apiKey: 'k', fetchImpl });
  const { server, base } = await boot({ speaker: enabled });
  t.after(() => server.close());

  await withProvider('openai', async () => {
    const res = await ttsPost(base, { sessionId: 's1', text: 'Tell me about a product.' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.contentType, 'audio/mpeg');
    assert.deepEqual(Buffer.from(res.body.audio, 'base64'), audioBytes);

    const sent = fetchImpl.calls[0];
    const body = JSON.parse(sent.opts.body.toString('utf8'));
    assert.equal(body.input, 'Tell me about a product.');
    assert.equal(body.model, 'gpt-4o-mini-tts');
  });
});

test('POST /api/tts surfaces upstream failures as 502', async (t) => {
  const fetchImpl = fakeFetch(new Response('boom', { status: 500 }));
  const enabled = createSpeaker({ provider: 'deepgram', apiKey: 'k', fetchImpl });
  const { server, base } = await boot({ speaker: enabled });
  t.after(() => server.close());

  await withProvider('deepgram', async () => {
    const res = await ttsPost(base, { text: 'Hi' });
    assert.equal(res.status, 502);
    assert.match(res.body.error, /Deepgram TTS responded 500/);
  });
});

test('successful synthesis is traced as a tts row with a cost', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-trace-'));
  const traceStore = createTraceStore({ rootDir: root });
  const fetchImpl = fakeFetch(audioResponse(Buffer.from('mp3'), 'audio/mpeg'));
  const enabled = createSpeaker({ provider: 'openai', apiKey: 'k', fetchImpl });
  const { server, base } = await boot({ speaker: enabled, traceStore });
  t.after(() => server.close());

  await withProvider('openai', async () => {
    const res = await ttsPost(base, { sessionId: 'voice-session', text: 'Spark.' });
    assert.equal(res.status, 200);

    const callsDir = path.join(root, 'voice-session', 'calls');
    const files = fs.readdirSync(callsDir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1);
    const call = JSON.parse(fs.readFileSync(path.join(callsDir, files[0]), 'utf8'));
    assert.equal(call.label, 'tts');
    assert.equal(call.success, true);
    assert.equal(call.provider, 'openai');
    assert.equal(call.prompt, 'Spark.');
    assert.ok(call.costUsd > 0, 'openai tts cost recorded');
  });
});

test('no trace is written for tts when sessionId is absent', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-notrace-'));
  const traceStore = createTraceStore({ rootDir: root });
  const fetchImpl = fakeFetch(audioResponse(Buffer.from('x'), 'audio/mpeg'));
  const enabled = createSpeaker({ provider: 'openai', apiKey: 'k', fetchImpl });
  const { server, base } = await boot({ speaker: enabled, traceStore });
  t.after(() => server.close());

  await withProvider('openai', async () => {
    const res = await ttsPost(base, { text: 'Hi' });
    assert.equal(res.status, 200);
    assert.equal(fs.readdirSync(root).filter((f) => f.endsWith('.json')).length, 0);
  });
});