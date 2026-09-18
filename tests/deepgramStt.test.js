const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createTranscriber,
  buildRequest,
  extractTranscript,
  DEFAULT_MODEL,
  DEFAULT_URL,
} = require('../server/lib/deepgramStt');

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

const TRANSCRIPT = { results: { channels: [{ alternatives: [{ transcript: 'I would prioritize the high-signal features.' }] }] } };
const RESPONSE_OK = () => new Response(JSON.stringify(TRANSCRIPT), { status: 200 });

test('buildRequest targets the Deepgram listen endpoint with Token auth and the audio mime', () => {
  const req = buildRequest({ apiKey: 'dg-key', model: 'nova-3', audio: Buffer.from('bytes'), contentType: 'audio/webm' });
  assert.ok(req.url.startsWith(DEFAULT_URL + '?'));
  assert.ok(req.url.includes('model=nova-3'));
  assert.ok(req.url.includes('smart_format=true'));
  assert.ok(req.url.includes('filler_words=false'));
  assert.equal(req.options.method, 'POST');
  assert.equal(req.options.headers.authorization, 'Token dg-key');
  assert.equal(req.options.headers['content-type'], 'audio/webm');
  assert.ok(Buffer.isBuffer(req.options.body));
});

test('contentType defaults to audio/webm when absent', () => {
  const req = buildRequest({ apiKey: 'k', model: 'nova-3', audio: Buffer.from('x') });
  assert.equal(req.options.headers['content-type'], 'audio/webm');
});

test('extractTranscript pulls the first alternative and trims', () => {
  assert.equal(extractTranscript(TRANSCRIPT), 'I would prioritize the high-signal features.');
  assert.equal(extractTranscript({ results: { channels: [{ alternatives: [{ transcript: '  ' }] }] } }), '');
  assert.equal(extractTranscript({}), '');
  assert.equal(extractTranscript(null), '');
});

test('defaults to the nova-3 model and reflects enabled from apiKey/env', () => {
  const configured = createTranscriber({ apiKey: 'k' });
  assert.equal(configured.provider, 'deepgram');
  assert.equal(configured.model, DEFAULT_MODEL);
  assert.equal(configured.enabled, true);

  const unconfigured = createTranscriber({ apiKey: '' });
  assert.equal(unconfigured.enabled, false);

  const original = process.env.DEEPGRAM_API_KEY;
  process.env.DEEPGRAM_API_KEY = 'env-key';
  try {
    assert.equal(createTranscriber().enabled, true);
    assert.equal(createTranscriber({ apiKey: 'explicit' }).enabled, true);
    delete process.env.DEEPGRAM_API_KEY;
    assert.equal(createTranscriber().enabled, false);
  } finally {
    if (original !== undefined) process.env.DEEPGRAM_API_KEY = original;
    else delete process.env.DEEPGRAM_API_KEY;
  }
});

test('transcribes audio through the injected fetch implementation', async () => {
  const fetchImpl = fakeFetch(RESPONSE_OK());
  const t = createTranscriber({ apiKey: 'k', fetchImpl });
  const text = await t.transcribe({ audio: Buffer.from('audio-bytes'), contentType: 'audio/webm;codecs=opus' });
  assert.equal(text, 'I would prioritize the high-signal features.');
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].opts.headers.authorization, 'Token k');
  assert.deepEqual(fetchImpl.calls[0].opts.body, Buffer.from('audio-bytes'));
});

test('throws a friendly error when no key is configured', async () => {
  const t = createTranscriber({ apiKey: '' });
  await assert.rejects(t.transcribe({ audio: Buffer.from('x') }), /DEEPGRAM_API_KEY/);
});

test('rejects empty audio before calling the API', async () => {
  const t = createTranscriber({ apiKey: 'k', fetchImpl: fakeFetch(RESPONSE_OK()) });
  await assert.rejects(t.transcribe({ audio: Buffer.alloc(0) }), /No audio received/);
});

test('surfaces upstream auth and generic failures', async () => {
  const auth = createTranscriber({
    apiKey: 'k',
    fetchImpl: fakeFetch(new Response(JSON.stringify({}), { status: 401 })),
  });
  await assert.rejects(auth.transcribe({ audio: Buffer.from('x') }), /Check DEEPGRAM_API_KEY/);

  const boom = createTranscriber({
    apiKey: 'k',
    fetchImpl: fakeFetch(new Response(JSON.stringify({ err: 'nope' }), { status: 500 })),
  });
  await assert.rejects(boom.transcribe({ audio: Buffer.from('x') }), /Deepgram STT responded 500/);
});

test('maps network failures to reachable errors', async () => {
  const t = createTranscriber({
    apiKey: 'k',
    fetchImpl: fakeFetch(() => {
      throw new Error('socket hang up');
    }),
  });
  await assert.rejects(t.transcribe({ audio: Buffer.from('x') }), /Could not reach Deepgram STT/);
});