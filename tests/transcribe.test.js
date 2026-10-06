const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createTranscriber,
  PROVIDERS,
  estimateMinutes,
  calculateCost,
  DEFAULT_PROVIDER,
  DEFAULT_COHERE_LANGUAGE,
} = require('../server/lib/transcribe');

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

const DEEPGRAM_TRANSCRIPT = { results: { channels: [{ alternatives: [{ transcript: 'I would prioritize the high-signal features.' }] }] } };
const RESPONSE_OK = () => new Response(JSON.stringify(DEEPGRAM_TRANSCRIPT), { status: 200 });

test('provider factory selects deepgram by default and reflects env', () => {
  const original = process.env.STT_PROVIDER;
  delete process.env.STT_PROVIDER;
  try {
    const t = createTranscriber({ apiKey: 'k' });
    assert.equal(t.provider, 'deepgram');
    assert.equal(DEFAULT_PROVIDER, 'deepgram');
    assert.equal(t.model, 'nova-3');
  } finally {
    if (original !== undefined) process.env.STT_PROVIDER = original;
  }
});

test('openai provider maps to whisper-1 with Bearer auth and multipart body', async () => {
  const fetchImpl = fakeFetch(new Response(JSON.stringify({ text: 'Answer from whisper.' }), { status: 200 }));
  const t = createTranscriber({ provider: 'openai', apiKey: 'oa-key', fetchImpl });
  assert.equal(t.provider, 'openai');
  assert.equal(t.model, 'whisper-1');
  assert.equal(t.enabled, true);

  const { transcript } = await t.transcribe({ audio: Buffer.from('audio-bytes'), contentType: 'audio/webm' });
  assert.equal(transcript, 'Answer from whisper.');

  const sent = fetchImpl.calls[0];
  assert.ok(sent.url.startsWith('https://api.openai.com/v1/audio/transcriptions'));
  assert.equal(sent.opts.headers.authorization, 'Bearer oa-key');
  assert.match(sent.opts.headers['content-type'], /^multipart\/form-data; boundary=/);
  const body = sent.opts.body.toString('utf8');
  assert.match(body, /name="model"/);
  assert.match(body, /whisper-1/);
  assert.match(body, /name="file"/);
  assert.doesNotMatch(body, /name="language"/);
});

test('cohere provider passes the required language and rejects webm', async () => {
  const fetchImpl = fakeFetch(new Response(JSON.stringify({ text: 'Cohere answer.' }), { status: 200 }));
  const t = createTranscriber({ provider: 'cohere', apiKey: 'co-key', language: 'en', fetchImpl });
  assert.equal(t.provider, 'cohere');
  assert.equal(t.model, 'cohere-transcribe-03-2026');
  assert.equal(t.language, 'en');

  const { transcript } = await t.transcribe({ audio: Buffer.from('ogg-bytes'), contentType: 'audio/ogg' });
  assert.equal(transcript, 'Cohere answer.');
  const body = fetchImpl.calls[0].opts.body.toString('utf8');
  assert.match(body, /name="language"/);
  assert.match(body, /en/);
  assert.match(body, /cohere-transcribe-03-2026/);
  assert.match(body, /name="file"/);
  assert.match(body, /filename="recording\.ogg"/);
  assert.doesNotMatch(body, /name="audio"/);

  await assert.rejects(
    t.transcribe({ audio: Buffer.from('webm-bytes'), contentType: 'audio/webm;codecs=opus' }),
    /does not accept audio\/webm.*supported formats are flac, mp3, mpeg, mpga, ogg, wav/s
  );
});

test('cohere language and model defaults come from env', () => {
  const originalProvider = process.env.COHERE_STT_MODEL;
  const originalLang = process.env.STT_LANGUAGE;
  process.env.COHERE_STT_MODEL = 'cohere-transcribe-test-01';
  process.env.STT_LANGUAGE = 'fr';
  try {
    const t = createTranscriber({ provider: 'cohere', apiKey: 'co-key' });
    assert.equal(t.model, 'cohere-transcribe-test-01');
    assert.equal(t.language, 'fr');
  } finally {
    if (originalProvider !== undefined) process.env.COHERE_STT_MODEL = originalProvider;
    else delete process.env.COHERE_STT_MODEL;
    if (originalLang !== undefined) process.env.STT_LANGUAGE = originalLang;
    else delete process.env.STT_LANGUAGE;
  }
});

test('DEFAULT_COHERE_LANGUAGE is en', () => {
  assert.equal(DEFAULT_COHERE_LANGUAGE, 'en');
});

test('unknown STT_PROVIDER throws with the valid options', () => {
  assert.throws(() => createTranscriber({ provider: 'wat' }), /Unknown STT_PROVIDER 'wat'\. Use deepgram \| openai \| cohere\./);
});

test('deepgram request targets the listen endpoint with Token auth and mime', async () => {
  const fetchImpl = fakeFetch(RESPONSE_OK());
  const t = createTranscriber({ provider: 'deepgram', apiKey: 'dg-key', fetchImpl });
  const { transcript } = await t.transcribe({ audio: Buffer.from('bytes'), contentType: 'audio/webm;codecs=opus' });
  assert.equal(transcript, 'I would prioritize the high-signal features.');
  const sent = fetchImpl.calls[0];
  assert.ok(sent.url.startsWith('https://api.deepgram.com/v1/listen?'));
  assert.ok(sent.url.includes('model=nova-3'));
  assert.ok(sent.url.includes('smart_format=true'));
  assert.ok(sent.url.includes('filler_words=false'));
  assert.equal(sent.opts.method, 'POST');
  assert.equal(sent.opts.headers.authorization, 'Token dg-key');
  assert.equal(sent.opts.headers['content-type'], 'audio/webm', 'codec params stripped before forwarding');
  assert.deepEqual(sent.opts.body, Buffer.from('bytes'));
});

test('transcriber reports enabled from apiKey only — never the server env', () => {
  assert.equal(createTranscriber({ provider: 'deepgram', apiKey: '' }).enabled, false);
  assert.equal(createTranscriber({ provider: 'cohere', apiKey: 'x' }).enabled, true);

  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'env-oa-key';
  try {
    assert.equal(
      createTranscriber({ provider: 'openai' }).enabled,
      false,
      "a server env key must never enable STT on someone else's machine"
    );
  } finally {
    if (original !== undefined) process.env.OPENAI_API_KEY = original;
    else delete process.env.OPENAI_API_KEY;
  }
});

test('throws a friendly error when the provider key is missing', async () => {
  const t = createTranscriber({ provider: 'deepgram', apiKey: '' });
  await assert.rejects(t.transcribe({ audio: Buffer.from('x') }), /Add your key in Settings/);
});

test('rejects empty audio before calling the API', async () => {
  const t = createTranscriber({ provider: 'openai', apiKey: 'k', fetchImpl: fakeFetch(RESPONSE_OK()) });
  await assert.rejects(t.transcribe({ audio: Buffer.alloc(0) }), /No audio received/);
});

test('surfaces upstream auth and generic failures per provider', async () => {
  const auth = createTranscriber({
    provider: 'deepgram',
    apiKey: 'k',
    fetchImpl: fakeFetch(new Response(JSON.stringify({}), { status: 401 })),
  });
  await assert.rejects(auth.transcribe({ audio: Buffer.from('x') }), /Check the key you added in Settings/);

  const boom = createTranscriber({
    provider: 'cohere',
    apiKey: 'k',
    fetchImpl: fakeFetch(new Response(JSON.stringify({ err: 'nope' }), { status: 500 })),
  });
  await assert.rejects(boom.transcribe({ audio: Buffer.from('x'), contentType: 'audio/ogg' }), /Cohere STT responded 500/);
});

test('maps network failures to reachable errors', async () => {
  const t = createTranscriber({
    provider: 'openai',
    apiKey: 'k',
    fetchImpl: fakeFetch(() => {
      throw new Error('socket hang up');
    }),
  });
  await assert.rejects(t.transcribe({ audio: Buffer.from('x') }), /Could not reach OpenAI STT/);
});

test('empty transcripts come back as empty strings', async () => {
  const t = createTranscriber({
    provider: 'cohere',
    apiKey: 'k',
    fetchImpl: fakeFetch(new Response(JSON.stringify({}), { status: 200 })),
  });
  const { transcript } = await t.transcribe({ audio: Buffer.from('x'), contentType: 'audio/ogg' });
  assert.equal(transcript, '');
});

test('estimateMinutes uses nominal bitrates per mime', () => {
  const threeMinWebm = Buffer.alloc(Math.round(3 * 60 * 48000 / 8));
  assert.ok(Math.abs(estimateMinutes(threeMinWebm, 'audio/webm') - 3) < 0.05);
  const oneMinWav = Buffer.alloc(Math.round(60 * 705600 / 8));
  assert.ok(Math.abs(estimateMinutes(oneMinWav, 'audio/wav') - 1) < 0.05);
  assert.equal(estimateMinutes(Buffer.alloc(0), 'audio/webm'), 0);
});

test('calculateCost prices per minute from the PRICING table, null when unpriced', () => {
  const threeMinWebm = Buffer.alloc(Math.round(3 * 60 * 48000 / 8));
  const cost = calculateCost('deepgram', 'nova-3', threeMinWebm, 'audio/webm');
  assert.ok(Math.abs(cost - 3 * 0.0059) < 0.001);
  assert.equal(calculateCost('openai', 'whisper-1', Buffer.alloc(0), 'audio/webm'), null);
  assert.equal(calculateCost('deepgram', 'not-a-real-model', threeMinWebm, 'audio/webm'), null);
});

test('every provider has the config-role keys', () => {
  for (const name of Object.keys(PROVIDERS)) {
    const cfg = PROVIDERS[name];
    assert.ok(cfg.envKey);
    assert.ok(cfg.defaultModel);
    assert.equal(typeof cfg.buildRequest, 'function');
    assert.equal(typeof cfg.extractTranscript, 'function');
  }
});