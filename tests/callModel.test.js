const test = require('node:test');
const assert = require('node:assert/strict');

const { createCallModel, DEFAULT_PROVIDER, PROVIDERS } = require('../server/lib/callModel');

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

function responseWith(text) {
  return new Response(JSON.stringify(text), { status: 200 });
}

test('exposes the expected providers', () => {
  assert.deepEqual(Object.keys(PROVIDERS).sort(), ['anthropic', 'cohere', 'groq', 'openai']);
  assert.equal(PROVIDERS.cohere.url, 'https://api.cohere.com/v2/chat');
  assert.equal(PROVIDERS.groq.url, 'https://api.groq.com/openai/v1/chat/completions');
});

test('defaults to cohere when AI_PROVIDER is unset and honors it when set', async () => {
  const original = process.env.AI_PROVIDER;

  delete process.env.AI_PROVIDER;
  try {
    assert.equal(DEFAULT_PROVIDER, 'cohere');
    const fetchImpl = fakeFetch(responseWith({ message: { content: [{ type: 'text', text: '{"a":1}' }] } }));
    const call = createCallModel({ apiKey: 'k', fetchImpl });
    await call('x');
    assert.equal(fetchImpl.calls[0].url, 'https://api.cohere.com/v2/chat');
  } finally {
    if (original !== undefined) process.env.AI_PROVIDER = original;
  }

  process.env.AI_PROVIDER = 'groq';
  try {
    const fetchImpl = fakeFetch(responseWith({ choices: [{ message: { content: '{"a":1}' } }] }));
    const call = createCallModel({ apiKey: 'k', fetchImpl });
    await call('x');
    assert.equal(fetchImpl.calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  } finally {
    if (original !== undefined) process.env.AI_PROVIDER = original;
    else delete process.env.AI_PROVIDER;
  }
});

test('throws early when no API key is configured', () => {
  assert.throws(() => createCallModel({ apiKey: '' }), /COHERE_API_KEY/);
  assert.throws(() => createCallModel({ provider: 'openai', apiKey: '' }), /OPENAI_API_KEY/);
  assert.throws(() => createCallModel({ provider: 'groq', apiKey: '' }), /GROQ_API_KEY/);
  assert.throws(() => createCallModel({ provider: 'anthropic', apiKey: '' }), /ANTHROPIC_API_KEY/);
});

test('rejects unknown providers', () => {
  assert.throws(() => createCallModel({ provider: 'aws', apiKey: 'k' }), /Unknown AI provider 'aws'/);
});

test('cohere: v2 chat request shape, Bearer auth, content[] extraction', async () => {
  const fetchImpl = fakeFetch(
    responseWith({ message: { role: 'assistant', content: [{ type: 'text', text: '```json\n{"decision": "next_stage"}\n```' }] } })
  );
  const call = createCallModel({ provider: 'cohere', apiKey: 'sk-co', model: 'command-a-03-2025', fetchImpl });
  const out = await call('Grade this answer.');

  assert.deepEqual(out, { decision: 'next_stage' });
  const req = fetchImpl.calls[0];
  assert.equal(req.url, 'https://api.cohere.com/v2/chat');
  assert.equal(req.opts.headers.authorization, 'Bearer sk-co');
  const body = JSON.parse(req.opts.body);
  assert.equal(body.model, 'command-a-03-2025');
  assert.equal(body.messages[0].content, 'Grade this answer.');
  assert.equal(body.max_tokens, 4096);
});

test('cohere: uses the default model when none given', async () => {
  const fetchImpl = fakeFetch(responseWith({ message: { content: [{ type: 'text', text: '{"ok":1}' }] } }));
  const call = createCallModel({ provider: 'cohere', apiKey: 'k', fetchImpl });
  await call('x');
  const body = JSON.parse(fetchImpl.calls[0].opts.body);
  assert.equal(body.model, 'command-a-plus-05-2026');
});

test('cohere: caps thinking tokens for reasoning models only', async () => {
  const reply = { message: { content: [{ type: 'text', text: '{"ok":1}' }] } };
  const reasoning = fakeFetch(responseWith(reply));
  const reasoningCall = createCallModel({ provider: 'cohere', apiKey: 'k', model: 'command-a-plus-05-2026', fetchImpl: reasoning });
  await reasoningCall('x');
  assert.deepEqual(JSON.parse(reasoning.calls[0].opts.body).thinking, { token_budget: 2048 });

  const legacy = fakeFetch(responseWith(reply));
  const legacyCall = createCallModel({ provider: 'cohere', apiKey: 'k', model: 'command-a-03-2025', fetchImpl: legacy });
  await legacyCall('x');
  assert.equal(JSON.parse(legacy.calls[0].opts.body).thinking, undefined);

  const groq = fakeFetch(responseWith({ choices: [{ message: { content: '{"ok":1}' } }] }));
  const groqCall = createCallModel({ provider: 'groq', apiKey: 'k', fetchImpl: groq });
  await groqCall('x');
  assert.equal(JSON.parse(groq.calls[0].opts.body).thinking, undefined);
});

test('cohere: empty MAX_TOKENS output surfaces a clear diagnostic', async () => {
  const fetchImpl = fakeFetch(() =>
    responseWith({
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'long inner monologue…' }] },
      finish_reason: 'MAX_TOKENS',
      usage: { tokens: { input_tokens: 10, output_tokens: 4096, reasoning_tokens: 4096 } },
    })
  );
  const call = createCallModel({ provider: 'cohere', apiKey: 'k', fetchImpl, retries: 0, retryDelayMs: 1 });
  await assert.rejects(call('x'), /MAX_TOKENS/);
  await assert.rejects(call('x'), /send your answer again/);
});

test('anthropic: x-api-key + anthropic-version, messages body, content[] extraction', async () => {
  const fetchImpl = fakeFetch(
    responseWith({ content: [{ type: 'text', text: '```json\n{"overall_verdict": "strong"}\n```' }] })
  );
  const call = createCallModel({ provider: 'anthropic', apiKey: 'sk-an', model: 'claude-sonnet-5', fetchImpl });
  const out = await call('Grade this answer.');

  assert.deepEqual(out, { overall_verdict: 'strong' });
  const req = fetchImpl.calls[0];
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(req.opts.headers['x-api-key'], 'sk-an');
  assert.equal(req.opts.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(req.opts.body);
  assert.equal(body.model, 'claude-sonnet-5');
  assert.equal(body.messages[0].content, 'Grade this answer.');
});

test('openai: Bearer auth, chat/completions, choices[0] extraction', async () => {
  const fetchImpl = fakeFetch(
    responseWith({ choices: [{ index: 0, message: { content: '{"strong": true}' } }] })
  );
  const call = createCallModel({ provider: 'openai', apiKey: 'sk-op', model: 'gpt-4.1-mini', fetchImpl });
  const out = await call('Grade this answer.');

  assert.deepEqual(out, { strong: true });
  const req = fetchImpl.calls[0];
  assert.equal(req.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(req.opts.headers.authorization, 'Bearer sk-op');
  const body = JSON.parse(req.opts.body);
  assert.equal(body.model, 'gpt-4.1-mini');
});

test('groq: OpenAI-compatible endpoint with Bearer auth', async () => {
  const fetchImpl = fakeFetch(
    responseWith({ choices: [{ index: 0, message: { content: '{"strong": false}' } }] })
  );
  const call = createCallModel({ provider: 'groq', apiKey: 'gk', model: 'llama-3.3-70b-versatile', fetchImpl });
  const out = await call('Grade this answer.');

  assert.deepEqual(out, { strong: false });
  const req = fetchImpl.calls[0];
  assert.equal(req.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(req.opts.headers.authorization, 'Bearer gk');
  const body = JSON.parse(req.opts.body);
  assert.equal(body.model, 'llama-3.3-70b-versatile');
  assert.equal(body.messages[0].content, 'Grade this answer.');
});

test('retries 429 responses with backoff and succeeds on a later attempt', async () => {
  let attempts = 0;
  const fetchImpl = fakeFetch(() => {
    attempts += 1;
    if (attempts < 3) return new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 });
    return responseWith({ message: { content: [{ type: 'text', text: '{"ok":1}' }] } });
  });
  const call = createCallModel({ provider: 'cohere', apiKey: 'k', fetchImpl, retries: 2, retryDelayMs: 1 });
  const out = await call('x');
  assert.deepEqual(out, { ok: 1 });
  assert.equal(fetchImpl.calls.length, 3);
});

test('retries transient 5xx and network errors, then throws after exhausting retries', async () => {
  const fetchImpl = fakeFetch(() => {
    throw new Error('socket hang up');
  });
  const call = createCallModel({ provider: 'groq', apiKey: 'gk', fetchImpl, retries: 2, retryDelayMs: 1 });
  await assert.rejects(call('x'), /groq API request failed: socket hang up/);
  assert.equal(fetchImpl.calls.length, 3);
});

test('does not retry non-transient errors like 400', async () => {
  const fetchImpl = fakeFetch(new Response(JSON.stringify({}), { status: 400 }));
  const call = createCallModel({ provider: 'cohere', apiKey: 'k', fetchImpl, retries: 3, retryDelayMs: 1 });
  await assert.rejects(call('x'), /cohere API responded 400/);
  assert.equal(fetchImpl.calls.length, 1);
});

test('propagates non-200 API responses with details (after retries are exhausted)', async () => {
  const fetchImpl = fakeFetch(
    new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 })
  );
  const call = createCallModel({ provider: 'openai', apiKey: 'sk-op', fetchImpl });
  await assert.rejects(call('x'), /openai API responded 429/);
});

test('surfaces network failures', async () => {
  const fetchImpl = fakeFetch(() => {
    throw new Error('socket hang up');
  });
  const call = createCallModel({ provider: 'groq', apiKey: 'gk', fetchImpl });
  await assert.rejects(call('x'), /groq API request failed: socket hang up/);
});