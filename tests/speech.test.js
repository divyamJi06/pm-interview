const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSpeaker,
  PROVIDERS,
  computeCost,
  DEFAULT_PROVIDER,
  MAX_TTS_CHARS,
} = require('../server/lib/speech');

function audioResponse(body, { status = 200, contentType = 'audio/mpeg' } = {}) {
  const res = new Response(body, { status });
  res.headers.set('content-type', contentType);
  return res;
}

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

test('speaker factory selects deepgram by default and reflects env', () => {
  const original = process.env.TTS_PROVIDER;
  delete process.env.TTS_PROVIDER;
  try {
    const s = createSpeaker({ apiKey: 'k' });
    assert.equal(s.provider, 'deepgram');
    assert.equal(DEFAULT_PROVIDER, 'deepgram');
    assert.equal(s.model, 'aura-2-en-default');
    assert.equal(s.voice, 'aura-2-en-default');
    assert.equal(s.enabled, true);
  } finally {
    if (original !== undefined) process.env.TTS_PROVIDER = original;
  }
});

test('unknown TTS_PROVIDER throws with the valid options', () => {
  assert.throws(() => createSpeaker({ provider: 'wat' }), /Unknown TTS_PROVIDER 'wat'\. Use deepgram \| openai\./);
});

test('deepgram request targets the speak endpoint with Token auth and text body', async () => {
  const fetchImpl = fakeFetch(audioResponse(Buffer.from('mp3-bytes')));
  const s = createSpeaker({ provider: 'deepgram', apiKey: 'dg-key', fetchImpl });
  const { audio, contentType } = await s.speak({ text: 'Tell me about a product you shipped.' });
  assert.equal(audio.toString('utf8'), 'mp3-bytes');
  assert.equal(contentType, 'audio/mpeg');

  const sent = fetchImpl.calls[0];
  assert.ok(sent.url.startsWith('https://api.deepgram.com/v1/speak?'));
  assert.ok(sent.url.includes('model=aura-2-en-default'));
  assert.equal(sent.opts.method, 'POST');
  assert.equal(sent.opts.headers.authorization, 'Token dg-key');
  assert.equal(sent.opts.headers.accept, 'audio/mpeg');
  assert.deepEqual(JSON.parse(sent.opts.body.toString('utf8')), { text: 'Tell me about a product you shipped.' });
});

test('openai request maps to the speech endpoint with Bearer auth, model and voice', async () => {
  const fetchImpl = fakeFetch(audioResponse(Buffer.from('mp3'), { contentType: 'audio/mpeg' }));
  const s = createSpeaker({ provider: 'openai', apiKey: 'oa-key', fetchImpl });
  const { audio } = await s.speak({ text: 'Tell me about a failure.' });
  assert.equal(audio.length, 3);

  const sent = fetchImpl.calls[0];
  assert.ok(sent.url.startsWith('https://api.openai.com/v1/audio/speech'));
  assert.equal(sent.opts.headers.authorization, 'Bearer oa-key');
  const body = JSON.parse(sent.opts.body.toString('utf8'));
  assert.equal(body.model, 'gpt-4o-mini-tts');
  assert.equal(body.voice, 'alloy');
  assert.equal(body.input, 'Tell me about a failure.');
});

test('openai uses TTS_VOICE env or an explicit voice argument', async () => {
  const original = process.env.TTS_VOICE;
  process.env.TTS_VOICE = 'nova';
  try {
    const fetchImpl = fakeFetch(audioResponse(Buffer.from('x')));
    const env = createSpeaker({ provider: 'openai', apiKey: 'k', fetchImpl });
    assert.equal(env.voice, 'nova');
    await env.speak({ text: 'hi' });
    let body = JSON.parse(fetchImpl.calls[0].opts.body.toString('utf8'));
    assert.equal(body.voice, 'nova');

    const explicit = createSpeaker({
      provider: 'openai',
      apiKey: 'k',
      voice: 'shimmer',
    });
    assert.equal(explicit.voice, 'shimmer');
  } finally {
    if (original !== undefined) process.env.TTS_VOICE = original;
    else delete process.env.TTS_VOICE;
  }
});

test('speaker reports enabled from the provider api key', () => {
  assert.equal(createSpeaker({ provider: 'deepgram', apiKey: '' }).enabled, false);
  assert.equal(createSpeaker({ provider: 'openai', apiKey: 'x' }).enabled, true);
});

test('throws a friendly error when the provider key is missing', async () => {
  const s = createSpeaker({ provider: 'deepgram', apiKey: '' });
  await assert.rejects(s.speak({ text: 'hi' }), /Add your key in Settings/);
});

test('rejects empty and whitespace-only text before calling the provider', async () => {
  const fetchImpl = fakeFetch(audioResponse(Buffer.from('x')));
  const s = createSpeaker({ provider: 'openai', apiKey: 'k', fetchImpl });
  await assert.rejects(s.speak({ text: '' }), /Nothing to speak/);
  await assert.rejects(s.speak({ text: '   ' }), /Nothing to speak/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('rejects overlong text with the max length in the message', async () => {
  const s = createSpeaker({ provider: 'openai', apiKey: 'k', fetchImpl: fakeFetch(audioResponse(Buffer.from('x'))) });
  const long = 'x'.repeat(MAX_TTS_CHARS + 1);
  await assert.rejects(s.speak({ text: long }), new RegExp(`max ${MAX_TTS_CHARS}\\)\\.`));
});

test('surfaces upstream auth and generic failures per provider', async () => {
  const auth = createSpeaker({
    provider: 'openai',
    apiKey: 'k',
    fetchImpl: fakeFetch(new Response('{}', { status: 401 })),
  });
  await assert.rejects(auth.speak({ text: 'hi' }), /Check OPENAI_API_KEY/);

  const boom = createSpeaker({
    provider: 'deepgram',
    apiKey: 'k',
    fetchImpl: fakeFetch(new Response('nope', { status: 500 })),
  });
  await assert.rejects(boom.speak({ text: 'hi' }), /Deepgram TTS responded 500/);
});

test('maps network failures to reachable errors and aborted audio to a 502', async () => {
  const net = createSpeaker({
    provider: 'deepgram',
    apiKey: 'k',
    fetchImpl: fakeFetch(() => {
      throw new Error('socket hang up');
    }),
  });
  await assert.rejects(net.speak({ text: 'hi' }), /Could not reach Deepgram TTS/);

  const empty = createSpeaker({
    provider: 'deepgram',
    apiKey: 'k',
    fetchImpl: fakeFetch(audioResponse(Buffer.alloc(0))),
  });
  await assert.rejects(empty.speak({ text: 'hi' }), /returned empty audio/);
});

test('speak trims the text before sending', async () => {
  const fetchImpl = fakeFetch(audioResponse(Buffer.from('x')));
  const s = createSpeaker({ provider: 'openai', apiKey: 'k', fetchImpl });
  await s.speak({ text: '  Hello.  ' });
  const body = JSON.parse(fetchImpl.calls[0].opts.body.toString('utf8'));
  assert.equal(body.input, 'Hello.');
});

test('computeCost prices per million characters for published openai models', () => {
  const text = 'x'.repeat(1000);
  assert.ok(Math.abs(computeCost('openai', 'gpt-4o-mini-tts', text) - 0.6 / 1000) < 1e-7);
  assert.ok(Math.abs(computeCost('openai', 'tts-1', text) - 15 / 1000) < 1e-6);
  assert.equal(computeCost('openai', 'gpt-4o-mini-tts', ''), null);
  assert.equal(computeCost('deepgram', 'aura-2-en-default', text), null, 'deepgram is unpriced');
  assert.equal(computeCost('openai', 'not-a-real-model', text), null);
});

test('every TTS provider has the config-role keys', () => {
  for (const name of Object.keys(PROVIDERS)) {
    const cfg = PROVIDERS[name];
    assert.ok(cfg.envKey);
    assert.ok(cfg.defaultModel);
    assert.ok(cfg.defaultVoice);
    assert.equal(typeof cfg.buildRequest, 'function');
    assert.equal(typeof cfg.extractAudio, 'function');
  }
});