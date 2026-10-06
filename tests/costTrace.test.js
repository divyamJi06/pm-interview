const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createCallModel, calculateCost, PRICING, PROVIDERS } = require('../server/lib/callModel');
const { createTraceStore } = require('../server/lib/traceStore');
const { loadStageOrder } = require('../server/config/stageOrder');
const { makeDeps, begin, processAnswer } = require('../server/lib/interview');
const store = require('../server/lib/sessionStore');

function responseWith(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status });
}

test('pricing table covers every default model', () => {
  for (const provider of Object.values(PROVIDERS)) {
    assert.ok(PRICING[provider.defaultModel], `PRICING is missing ${provider.defaultModel}`);
  }
});

test('calculateCost multiplies input and output tokens by the model price', () => {
  assert.equal(
    calculateCost('command-a-plus-05-2026', 1000000, 1000000),
    2.5 + 10
  );
  assert.ok(Math.abs(calculateCost('gpt-4.1-mini', 1000, 250) - (0.0004 + 0.0004)) < 1e-9);
  assert.equal(calculateCost('gpt-4.1-mini', 0, 0), 0);
});

test('calculateCost returns null for unpriced models', () => {
  assert.equal(calculateCost('some-unknown-model', 100, 100), null);
});

test('callModel emits an onCall record with usage, cost, and output', async () => {
  const fetchImpl = async () =>
    responseWith({
      message: { content: [{ type: 'text', text: '{"decision":"next_stage"}' }] },
      usage: { tokens: { input_tokens: 1200, output_tokens: 80 } },
    });
  const call = createCallModel({ provider: 'cohere', apiKey: 'k', model: 'command-a-plus-05-2026', fetchImpl });
  const records = [];
  const parsed = await call('Grade this answer.', { label: 'judge-behavioral', onCall: (r) => records.push(r) });

  assert.deepEqual(parsed, { decision: 'next_stage' });
  assert.equal(records.length, 1);
  const r = records[0];
  assert.equal(r.provider, 'cohere');
  assert.equal(r.model, 'command-a-plus-05-2026');
  assert.equal(r.label, 'judge-behavioral');
  assert.equal(r.prompt, 'Grade this answer.');
  assert.match(r.outputText, /next_stage/);
  assert.deepEqual(r.usage, { inputTokens: 1200, outputTokens: 80 });
  assert.equal(r.costUsd, calculateCost('command-a-plus-05-2026', 1200, 80));
  assert.equal(r.success, true);
  assert.ok(r.durationMs >= 0);
});

test('extracts the provider-specific usage shape', async () => {
  const openai = createCallModel({
    provider: 'openai',
    apiKey: 'k',
    model: 'gpt-4.1-mini',
    fetchImpl: async () =>
      responseWith({ usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ message: { content: '{"ok":1}' } }] }),
  });
  let rec;
  await openai('x', { onCall: (r) => (rec = r) });
  assert.deepEqual(rec.usage, { inputTokens: 10, outputTokens: 5 });
  assert.equal(rec.costUsd, calculateCost('gpt-4.1-mini', 10, 5));

  const anthropic = createCallModel({
    provider: 'anthropic',
    apiKey: 'k',
    model: 'claude-sonnet-5',
    fetchImpl: async () =>
      responseWith({ usage: { input_tokens: 3, output_tokens: 9 }, content: [{ type: 'text', text: '{"ok":1}' }] }),
  });
  await anthropic('x', { onCall: (r) => (rec = r) });
  assert.deepEqual(rec.usage, { inputTokens: 3, outputTokens: 9 });
  assert.equal(rec.costUsd, calculateCost('claude-sonnet-5', 3, 9));
});

test('failed calls still emit an onCall record with the error', async () => {
  const call = createCallModel({
    provider: 'groq',
    apiKey: 'k',
    model: 'llama-3.3-70b-versatile',
    fetchImpl: async () => responseWith({ error: 'nope' }, 500),
    retries: 0,
    retryDelayMs: 1,
  });
  const records = [];
  await assert.rejects(
    call('x', { label: 'director-estimation', onCall: (r) => records.push(r) }),
    /groq API responded 500/
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].success, false);
  assert.equal(records[0].label, 'director-estimation');
  assert.match(records[0].error, /responded 500/);
});

test('traceStore writes info, per-call files, and a cost summary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-'));
  const ts = createTraceStore({ rootDir: dir });
  ts.initSession({ sessionId: 'abc', mode: 'mock', targetRoleAndLevel: 'Senior PM', config: loadStageOrder() });
  ts.recordCall({
    sessionId: 'abc',
    record: {
      provider: 'cohere', model: 'command-a-plus-05-2026', label: 'judge-behavioral',
      prompt: 'p1', success: true, outputText: 'o1',
      usage: { inputTokens: 1000, outputTokens: 100 }, costUsd: 0.0035, durationMs: 40,
    },
  });
  ts.recordCall({
    sessionId: 'abc',
    record: { provider: 'cohere', model: 'command-a-plus-05-2026', label: 'director-behavioral', prompt: 'p2', success: false, error: 'API down', durationMs: 5 },
  });
  const summary = ts.finalizeSession({ sessionId: 'abc', outcome: 'finished' });

  const info = JSON.parse(fs.readFileSync(path.join(dir, 'abc', 'info.json'), 'utf8'));
  assert.equal(info.sessionId, 'abc');
  assert.equal(info.mode, 'mock');
  assert.deepEqual(info.stages, ['greeting', 'behavioral', 'estimation', 'product_design', 'case_study', 'strategy', 'execution_metrics', 'technical']);

  const files = fs.readdirSync(path.join(dir, 'abc', 'calls')).sort();
  assert.deepEqual(files, ['001-judge-behavioral.json', '002-director-behavioral.json']);
  const first = JSON.parse(fs.readFileSync(path.join(dir, 'abc', 'calls', '001-judge-behavioral.json'), 'utf8'));
  assert.equal(first.seq, 1);
  assert.equal(first.label, 'judge-behavioral');
  assert.equal(first.prompt, 'p1');

  assert.equal(summary.totals.calls, 2);
  assert.equal(summary.totals.success, 1);
  assert.equal(summary.totals.failed, 1);
  assert.equal(summary.totals.inputTokens, 1000);
  assert.equal(summary.totals.outputTokens, 100);
  assert.equal(summary.totals.costUsd, 0.0035);
  assert.deepEqual(summary.callsByLabel, { 'director-behavioral': 1, 'judge-behavioral': 1 });
});

test('traceStore sequence continues after a restart instead of colliding', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-restart-'));
  const first = createTraceStore({ rootDir: dir });
  first.initSession({ sessionId: 'cont', mode: 'mock', config: loadStageOrder() });
  first.recordCall({ sessionId: 'cont', record: { label: 'judge-behavioral', success: true } });
  first.recordCall({ sessionId: 'cont', record: { label: 'profile-behavioral', success: true } });

  const second = createTraceStore({ rootDir: dir });
  second.recordCall({ sessionId: 'cont', record: { label: 'judge-case_study', success: true } });

  const files = fs.readdirSync(path.join(dir, 'cont', 'calls')).sort();
  assert.deepEqual(files, [
    '001-judge-behavioral.json',
    '002-profile-behavioral.json',
    '003-judge-case_study.json',
  ]);
  const third = JSON.parse(fs.readFileSync(path.join(dir, 'cont', 'calls', '003-judge-case_study.json'), 'utf8'));
  assert.equal(third.seq, 3, 'resumed session must not restart numbering at 1');
});

function judgeOutput(isChecklist) {
  return {
    ...(isChecklist ? { checklist_hits: { 'Make an equation': true } } : {}),
    dimension_scores: { quality: 4 },
    green_flags_hit: [],
    red_flags_hit: [],
    summary: 'Solid.',
    overall_verdict: 'strong',
    updated_profile: ['tests assumptions'],
  };
}

function directorDecision(prompt) {
  const asked = /Questions asked: (\d+) \/ (\d+)/.exec(prompt);
  const last = /IS THIS THE LAST STAGE OF THE INTERVIEW:\s*(\w+)/.exec(prompt);
  assert.ok(asked && last, 'director prompt must be fully filled:\n' + prompt);
  let decision;
  if (Number(asked[1]) < Number(asked[2])) {
    decision = 'next_question';
  } else if (last[1] === 'true') {
    decision = 'end_interview';
  } else {
    decision = 'next_stage';
  }
  return { decision, reasoning: 'scripted' };
}

function makeTracedCallModel() {
  return async function callModel(prompt, opts = {}) {
    const record = {
      provider: 'cohere',
      model: 'command-a-plus-05-2026',
      label: opts.label || 'model_call',
      prompt,
      success: true,
      outputText: '{"ok":true}',
      usage: { inputTokens: 10, outputTokens: 5 },
      costUsd: calculateCost('command-a-plus-05-2026', 10, 5),
      durationMs: 1,
    };
    if (opts.onCall) opts.onCall(record);
    if (prompt.includes('You are grading a candidate')) return judgeOutput(prompt.includes('IDEAL PROCESS'));
    if (prompt.includes('deciding what happens next')) return directorDecision(prompt);
    if (prompt.includes('writing a stage-level verdict')) return { stage_verdict: 'strong', summary: 'ok', strengths: [], gaps: [] };
    if (prompt.includes('writing the final overall assessment')) {
      return { overall_verdict: 'strong', summary: 'ok', cross_stage_patterns: [], top_things_to_work_on: [], recommended_resources: [] };
    }
    if (prompt.includes('You are coaching a PM interview candidate')) {
      return { action_plan: [], priority_order: [] };
    }
    throw new Error('Mock callModel got an unexpected prompt:\n' + prompt.slice(0, 300));
  };
}

test('a full practice session writes a navigable, costed trace per session', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-int-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ts = createTraceStore({ rootDir: dir });
  store.clearSessions();
  const session = store.createSession({ mode: 'practice', practiceStage: 'estimation', targetRoleAndLevel: 'Senior PM' });
  const deps = makeDeps({ callModel: makeTracedCallModel(), config: loadStageOrder(), traceStore: ts });

  begin(session, deps);
  const payload = await processAnswer({ session, answerText: 'Assuming 8 billion people...', deps });
  assert.equal(payload.state, 'final_report');

  const dirPath = path.join(dir, session.id);
  assert.ok(fs.existsSync(path.join(dirPath, 'info.json')));
  assert.ok(fs.existsSync(path.join(dirPath, 'cost-summary.json')));
  const files = fs.readdirSync(path.join(dirPath, 'calls')).sort();
  assert.deepEqual(files, [
    '001-judge-estimation.json',
    '002-director-estimation.json',
    '003-synthesizer-stage-estimation.json',
    '004-synthesizer-interview.json',
    '005-coach.json',
  ]);

  const judge = JSON.parse(fs.readFileSync(path.join(dirPath, 'calls', '001-judge-estimation.json'), 'utf8'));
  assert.equal(judge.label, 'judge-estimation');
  assert.match(judge.prompt, /You are grading a candidate/);

  const coach = JSON.parse(fs.readFileSync(path.join(dirPath, 'calls', '005-coach.json'), 'utf8'));
  assert.equal(coach.label, 'coach');
  assert.match(coach.prompt, /You are coaching a PM interview candidate/);

  const summary = JSON.parse(fs.readFileSync(path.join(dirPath, 'cost-summary.json'), 'utf8'));
  assert.equal(summary.totals.calls, 5);
  assert.equal(summary.totals.success, 5);
  assert.equal(summary.totals.failed, 0);
  assert.deepEqual(summary.callsByLabel, {
    'director-estimation': 1,
    'judge-estimation': 1,
    'synthesizer-stage-estimation': 1,
    'synthesizer-interview': 1,
    coach: 1,
  });
});