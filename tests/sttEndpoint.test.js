const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

const { createServer } = require('../server/server');
const { createTranscriber } = require('../server/lib/deepgramStt');

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

async function boot({ transcriber }) {
  const server = createServer({ transcriber });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function sttPost(base, body, contentType) {
  const res = await fetch(base + '/api/stt', {
    method: 'POST',
    headers: { 'content-type': contentType || 'audio/webm' },
    body,
  });
  return { status: res.status, body: await res.json() };
}

test('stt config reports the provider and enabled state', async (t) => {
  const disabled = createTranscriber({ apiKey: '' });
  const { server, base } = await boot({ transcriber: disabled });
  t.after(() => server.close());

  const res = await fetch(base + '/api/stt/config');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual({ ok: body.ok, enabled: body.enabled, provider: body.provider, model: body.model }, {
    ok: true,
    enabled: false,
    provider: 'deepgram',
    model: 'nova-3',
  });
});

test('stt config reflects an enabled transcriber and a custom model', async (t) => {
  const enabled = createTranscriber({ apiKey: 'k', model: 'nova-2' });
  const { server, base } = await boot({ transcriber: enabled });
  t.after(() => server.close());

  const body = await (await fetch(base + '/api/stt/config')).json();
  assert.equal(body.enabled, true);
  assert.equal(body.model, 'nova-2');
});

test('POST /api/stt returns 503 when no Deepgram key is configured', async (t) => {
  const disabled = createTranscriber({ apiKey: '' });
  const { server, base } = await boot({ transcriber: disabled });
  t.after(() => server.close());

  const res = await sttPost(base, Buffer.from('audio'));
  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /DEEPGRAM_API_KEY/);
});

test('POST /api/stt transcribes audio and returns the text', async (t) => {
  const fetchImpl = fakeFetch(
    new Response(
      JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: 'Speak your answer aloud.' }] }] } }),
      { status: 200 }
    )
  );
  const enabled = createTranscriber({ apiKey: 'k', fetchImpl });
  const { server, base } = await boot({ transcriber: enabled });
  t.after(() => server.close());

  const res = await sttPost(base, Buffer.from('fake-webm-bytes'), 'audio/webm;codecs=opus');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.text, 'Speak your answer aloud.');

  assert.equal(fetchImpl.calls.length, 1);
  const sent = fetchImpl.calls[0];
  assert.equal(sent.opts.headers.authorization, 'Token k');
  assert.equal(sent.opts.headers['content-type'], 'audio/webm', 'codec params are stripped before forwarding');
  assert.deepEqual(sent.opts.body, Buffer.from('fake-webm-bytes'));
});

test('POST /api/stt returns 400 for an empty body', async (t) => {
  const fetchImpl = fakeFetch(() => {
    throw new Error('should not be called');
  });
  const enabled = createTranscriber({ apiKey: 'k', fetchImpl });
  const { server, base } = await boot({ transcriber: enabled });
  t.after(() => server.close());

  const res = await sttPost(base, '');
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test('POST /api/stt surfaces upstream failures as 502', async (t) => {
  const fetchImpl = fakeFetch(new Response(JSON.stringify({}), { status: 500 }));
  const enabled = createTranscriber({ apiKey: 'k', fetchImpl });
  const { server, base } = await boot({ transcriber: enabled });
  t.after(() => server.close());

  const res = await sttPost(base, Buffer.from('audio'));
  assert.equal(res.status, 502);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /Deepgram STT responded 500/);
});