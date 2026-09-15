const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createServer } = require('../server/server');
const { loadStageOrder } = require('../server/config/stageOrder');
const store = require('../server/lib/sessionStore');
const candidateStore = require('../server/lib/candidateStore');
const rounds = require('../server/lib/rounds');

function judgeOutput(isChecklist) {
  return {
    ...(isChecklist ? { checklist_hits: { 'Make an equation': true } } : {}),
    dimension_scores: { quality: 4 },
    green_flags_hit: ['states assumptions clearly'],
    red_flags_hit: [],
    summary: 'Solid, structured answer.',
    overall_verdict: 'strong',
  };
}

function directorDecision(prompt) {
  const asked = /Questions asked: (\d+) \/ (\d+)/.exec(prompt);
  const fuQ = Number(/Follow-ups asked on this question so far: (\d+)/.exec(prompt)?.[1] || 0);
  const last = /IS THIS THE LAST STAGE OF THE INTERVIEW:\s*(\w+)/.exec(prompt);
  assert.ok(asked && last, 'director prompt must be fully filled:\n' + prompt);

  let decision;
  if (fuQ < 2) {
    decision = 'follow_up';
  } else if (Number(asked[1]) < Number(asked[2])) {
    decision = 'next_question';
  } else if (last[1] === 'true') {
    decision = 'end_interview';
  } else {
    decision = 'next_stage';
  }
  return { decision, follow_up_question: decision === 'follow_up' ? 'Why did you commit to that?' : undefined, reasoning: 'scripted test decision' };
}

function makeMockCallModel() {
  const prompts = [];
  const mock = {
    prompts,
    classify: 'answer',
    clarifyAnswer: 'Assume a population around 8 billion nationwide.',
    clarifyWrapUp: false,
    callModel(prompt) {
      prompts.push(prompt);
      if (prompt.includes('You are routing messages')) {
        return { type: mock.classify };
      }
      if (prompt.includes('You are grading a candidate')) {
        return judgeOutput(prompt.includes('IDEAL PROCESS'));
      }
      if (prompt.includes('maintaining a short running profile')) {
        return { updated_profile: ['tests assumptions before committing'] };
      }
      if (prompt.includes('deciding what happens next')) {
        return directorDecision(prompt);
      }
      if (prompt.includes('You are the interviewer in a PM mock interview')) {
        return { answer: mock.clarifyAnswer, wrap_up: mock.clarifyWrapUp };
      }
      if (prompt.includes('writing a stage-level verdict')) {
        return { stage_verdict: 'strong', summary: 'Consistent across the stage.', strengths: ['structure'], gaps: [] };
      }
      if (prompt.includes('writing the final overall assessment')) {
        return {
          overall_verdict: 'strong',
          summary: 'Strong across all stages.',
          cross_stage_patterns: ['structured but slightly slow to commit'],
          top_things_to_work_on: ['commit faster'],
          recommended_resources: [
            { title: 'Thinking in Bets — Annie Duke', type: 'book', why: 'practice committing to decisions under uncertainty' },
          ],
        };
      }
      throw new Error('Mock callModel got an unexpected prompt:\n' + prompt.slice(0, 300));
    },
  };
  return mock;
}

async function boot(mock) {
  const server = createServer({ callModel: mock.callModel, config: loadStageOrder(), rng: () => 0 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function post(base, path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(base, path) {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
}

test('health and stages endpoints', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());

  const health = await get(base, '/api/health');
  assert.equal(health.status, 200);

  const stages = await get(base, '/api/stages');
  assert.equal(stages.status, 200);
  assert.deepEqual(
    stages.body.stages.map((s) => s.name),
    ['greeting', 'behavioral', 'estimation', 'product_design', 'case_study', 'strategy', 'execution_metrics', 'technical']
  );
  assert.equal(stages.body.feedbackTiming, 'stage_boundary');
});

test('full mock interview runs every stage and produces a final report', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();

  const started = await post(base, '/api/start', { mode: 'mock', targetRole: 'Senior PM' });
  assert.equal(started.status, 200);
  assert.equal(started.body.state, 'question');
  assert.equal(started.body.stage.name, 'greeting');
  assert.ok(started.body.question.text.length > 0);

  const seen = [];
  let sessionId = started.body.sessionId;
  let guard = 0;

  while (true) {
    const res = await post(base, '/api/answer', { sessionId, answer: 'My detailed answer.' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true, JSON.stringify(res.body));
    const payload = res.body;

    if (payload.state === 'question') {
      seen.push('question:' + payload.stage.name);
      assert.equal(payload.feedback, null, 'mock mode never shows per-answer feedback');
    } else if (payload.state === 'follow_up') {
      seen.push('follow_up:' + payload.stage.name);
      assert.equal(payload.question.isFollowUp, true);
    } else if (payload.state === 'transition') {
      seen.push('transition:' + payload.transition.from + '->' + payload.transition.to);
      if (payload.transition.from !== 'greeting') {
        assert.ok(payload.transition.stageVerdict, 'stage-boundary feedback reveals the verdict for graded stages');
      }
      assert.ok(payload.question);
    } else if (payload.state === 'final_report') {
      seen.push('final_report');
      assert.equal(payload.report.report.overall_verdict, 'strong');
      assert.ok(payload.report.report.cross_stage_patterns.length > 0);
      assert.equal(payload.report.report.recommended_resources[0].title, 'Thinking in Bets — Annie Duke');
      const stages = payload.report.stageVerdicts.map((v) => v.stage);
      assert.deepEqual(stages, ['behavioral', 'estimation', 'product_design', 'case_study', 'strategy', 'execution_metrics', 'technical']);
      break;
    } else {
      assert.fail('unknown state ' + payload.state);
    }

    guard += 1;
    assert.ok(guard < 100, 'interview did not terminate');
  }

  assert.ok(seen.includes('transition:greeting->behavioral'));
  assert.ok(seen.includes('transition:behavioral->estimation'));
  assert.ok(seen.includes('final_report'));

  const synthPrompt = mock.prompts.find((p) => p.includes('writing the final overall assessment'));
  assert.ok(synthPrompt.includes('RESOURCE BANK:'), 'final report prompt includes the resource bank header');
  assert.ok(!synthPrompt.includes('(no curated resource bank configured)'), 'the shipped resource bank is loaded');
  assert.ok(synthPrompt.includes('Statistical & probabilistic reasoning'), 'resources are dimension-labeled');
});

test('practice mode shows feedback after every answer and one stage verdict', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();

  const started = await post(base, '/api/start', { mode: 'practice', stage: 'product_design' });
  assert.equal(started.status, 200);
  assert.equal(started.body.stage.name, 'product_design');

  let sessionId = started.body.sessionId;
  let guard = 0;
  let final;
  while (true) {
    const r = await post(base, '/api/answer', { sessionId, answer: 'Let me restructure the problem...' });
    assert.equal(r.status, 200);
    assert.ok(r.body.feedback, 'practice mode returns judge feedback');
    assert.equal(r.body.feedback.overall_verdict, 'strong');
    if (r.body.state === 'final_report') {
      final = r.body;
      break;
    }
    assert.ok(r.body.state === 'question' || r.body.state === 'follow_up', 'stage keeps progressing');
    guard += 1;
    assert.ok(guard < 30, 'practice did not finish');
  }

  assert.equal(final.report.stageVerdicts.length, 1);
  assert.equal(final.report.stageVerdicts[0].stage, 'product_design');
});

test('estimation practice uses the checklist judge and finishes its questions', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();

  const started = await post(base, '/api/start', { mode: 'practice', stage: 'estimation' });
  const sessionId = started.body.sessionId;

  let guard = 0;
  let final;
  while (true) {
    const r = await post(base, '/api/answer', { sessionId, answer: 'Assuming 1.4 billion people...' });
    assert.equal(r.status, 200);
    if (r.body.state === 'final_report') {
      final = r.body;
      break;
    }
    assert.equal(r.body.state, 'follow_up', 'the Director decides follow-ups per question');
    assert.ok(r.body.feedback && r.body.feedback.checklist_hits, 'estimation uses the checklist judge');
    guard += 1;
    assert.ok(guard < 30, 'estimation practice did not finish');
  }

  assert.ok(final.feedback && final.feedback.checklist_hits, 'final answer feedback shows the checklist judge');
  assert.equal(final.report.stageVerdicts.length, 1);
  assert.equal(final.report.stageVerdicts[0].stage, 'estimation');
});

test('follow-ups are tracked, counted, and reset per question', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();

  const started = await post(base, '/api/start', { mode: 'practice', stage: 'behavioral' });
  const sessionId = started.body.sessionId;

  const r1 = await post(base, '/api/answer', { sessionId, answer: 'First answer.' });
  assert.equal(r1.body.state, 'follow_up');
  assert.equal(r1.body.question.isFollowUp, true);
  assert.equal(r1.body.stageProgress.followUpsUsed, 1);
  assert.equal(r1.body.stageProgress.followUpsThisQuestion, 1);

  const r2 = await post(base, '/api/answer', { sessionId, answer: 'Addressing the follow-up.' });
  assert.equal(r2.body.state, 'follow_up');
  assert.equal(r2.body.stageProgress.followUpsUsed, 2);
  assert.equal(r2.body.stageProgress.followUpsThisQuestion, 2);

  const r3 = await post(base, '/api/answer', { sessionId, answer: 'More.' });
  assert.equal(r3.body.state, 'question');
  assert.equal(r3.body.question.isFollowUp, false);
  assert.equal(r3.body.stageProgress.followUpsUsed, 2);
  assert.equal(r3.body.stageProgress.followUpsThisQuestion, 0, 'per-question count resets on a new main question');

  const r4 = await post(base, '/api/answer', { sessionId, answer: 'Second main answer.' });
  assert.equal(r4.body.state, 'follow_up');
  assert.equal(r4.body.stageProgress.followUpsUsed, 3);

  const r5 = await post(base, '/api/answer', { sessionId, answer: 'More depth.' });
  assert.equal(r5.body.state, 'follow_up');
  assert.equal(r5.body.stageProgress.followUpsUsed, 4);

  const r6 = await post(base, '/api/answer', { sessionId, answer: 'Wrapping up.' });
  assert.equal(r6.body.state, 'final_report');
  assert.equal(r6.body.report.stageVerdicts.length, 1);
});

test('a clarifying question is auto-detected, answered, and fed to the judge', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();

  const started = await post(base, '/api/start', { mode: 'practice', stage: 'estimation' });
  assert.equal(started.status, 200);
  const sessionId = started.body.sessionId;

  mock.classify = 'clarify';
  const c = await post(base, '/api/answer', {
    sessionId,
    answer: 'What population should I assume?',
  });
  assert.equal(c.status, 200);
  assert.equal(c.body.state, 'clarify_reply');
  assert.match(c.body.clarifyAnswer, /8 billion/);
  assert.equal(c.body.wrapUp, false);
  assert.equal(c.body.question.isFollowUp, false);

  mock.classify = 'answer';
  const a = await post(base, '/api/answer', { sessionId, answer: 'Assuming 8 billion, here is the estimate...' });
  assert.equal(a.status, 200);
  assert.ok(a.body.state === 'follow_up' || a.body.state === 'final_report', 'stage keeps progressing after clarification');

  const judgePrompt = mock.prompts.find((p) => p.includes('You are grading a candidate'));
  assert.ok(judgePrompt.includes('CLARIFYING EXCHANGE BEFORE THE ANSWER'));
  assert.match(judgePrompt, /What population should I assume/);
});

test('an optional resume is fed to the profile agent and truncated to the cap', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();

  const started = await post(base, '/api/start', {
    mode: 'practice',
    stage: 'behavioral',
    resume: 'Led payments at a fintech. Grew team from 3 to 8. ' + 'Z'.repeat(9000),
  });
  assert.equal(started.status, 200);
  const sessionId = started.body.sessionId;

  const answer = await post(base, '/api/answer', { sessionId, answer: 'My structured answer.' });
  assert.equal(answer.status, 200);

  const profilePrompt = mock.prompts.find((p) => p.includes('maintaining a short running profile'));
  assert.ok(profilePrompt, 'the profile agent ran');
  assert.ok(profilePrompt.includes("CANDIDATE'S RESUME / BACKGROUND"), 'profile prompt has the resume section');
  assert.ok(profilePrompt.includes('Led payments at a fintech'), 'resume content reaches the profile agent');
  assert.ok(profilePrompt.includes('Grew team from 3 to 8'), 'head of the resume is kept intact');
  assert.ok(profilePrompt.includes('Z'.repeat(7900)), 'resume is present up to the 8000-char cap, minus the head');
  assert.ok(!profilePrompt.includes('Z'.repeat(9000)), 'resume past the cap is dropped');
});

test('when the interviewer asks for the answer, further clarifications are refused', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();

  const started = await post(base, '/api/start', { mode: 'practice', stage: 'behavioral' });
  const sessionId = started.body.sessionId;

  mock.classify = 'clarify';
  mock.clarifyWrapUp = true;
  const c1 = await post(base, '/api/answer', { sessionId, answer: 'What are the constraints?' });
  assert.equal(c1.status, 200);
  assert.equal(c1.body.state, 'clarify_reply');
  assert.equal(c1.body.wrapUp, false, 'no wrap-up on the very first clarifying question');

  const c2 = await post(base, '/api/answer', { sessionId, answer: 'And the audience?' });
  assert.equal(c2.status, 200);
  assert.equal(c2.body.wrapUp, true);

  const c3 = await post(base, '/api/answer', { sessionId, answer: 'One more question?' });
  assert.equal(c3.status, 409);
  assert.match(c3.body.error, /has asked you to answer now/);
});

test('error handling: unknown session and empty answer', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());

  const missing = await post(base, '/api/answer', { sessionId: 'does-not-exist', answer: 'hi' });
  assert.equal(missing.status, 404);

  const started = await post(base, '/api/start', { mode: 'mock' });
  const sessionId = started.body.sessionId;
  const empty = await post(base, '/api/answer', { sessionId, answer: '   ' });
  assert.equal(empty.status, 400);

  const badStage = await post(base, '/api/start', { mode: 'practice', stage: 'nope' });
  assert.equal(badStage.status, 400);
});

test('index page is served on GET /', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());

  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /PM Interview Prep/);
});

test('a judge failure surfaces as an error, not a crash', async (t) => {
  const mock = makeMockCallModel();
  const orig = mock.callModel;
  mock.callModel = async (prompt) => {
    if (prompt.includes('You are grading')) throw new Error('API down');
    return orig(prompt);
  };
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();

  const started = await post(base, '/api/start', { mode: 'practice', stage: 'behavioral' });
  const res = await post(base, '/api/answer', { sessionId: started.body.sessionId, answer: 'hi' });
  assert.equal(res.status, 502);
  assert.match(res.body.error, /API down/);
});

test('trace endpoints list and serve sessions from the configured traceDir', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-server-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const idA = 'aaa111-2222-3333-4444-555555555555';
  const idB = 'bbb111-2222-3333-4444-555555555555';
  fs.mkdirSync(path.join(root, idA, 'calls'), { recursive: true });
  fs.mkdirSync(path.join(root, idB, 'calls'), { recursive: true });

  fs.writeFileSync(
    path.join(root, idA, 'info.json'),
    JSON.stringify({ mode: 'practice', practiceStage: 'estimation', startedAt: '2026-09-12T08:00:00.000Z' })
  );
  fs.writeFileSync(
    path.join(root, idA, 'cost-summary.json'),
    JSON.stringify({ outcome: 'finished', endedAt: '2026-09-12T08:01:30.000Z', totals: { calls: 1, inputTokens: 10, outputTokens: 5, costUsd: 0.001 } })
  );
  const judgePrompt = [
    'You are grading a candidate in a PM interview.',
    'QUESTION ASKED: How big is the coffee market?',
    'CLARIFYING EXCHANGE BEFORE THE ANSWER',
    "CANDIDATE'S ANSWER: About $40B.",
    'Weigh the clarifying exchange',
  ].join('\n');
  fs.writeFileSync(
    path.join(root, idA, 'calls', '0001.json'),
    JSON.stringify({ seq: 1, label: 'classify-turn', success: true, prompt: 'You are routing messages...', outputText: 'answer', parsed: { type: 'answer' } })
  );
  fs.writeFileSync(
    path.join(root, idA, 'calls', '0002.json'),
    JSON.stringify({ seq: 2, label: 'judge-estimation', success: true, prompt: judgePrompt, outputText: '...', parsed: { overall_verdict: 'strong', summary: 'Good.' } })
  );
  fs.writeFileSync(
    path.join(root, idA, 'calls', '0003-synthesizer-stage-estimation.json'),
    JSON.stringify({ seq: 3, label: 'synthesizer-stage-estimation', success: true, prompt: 'You are writing a stage-level verdict...', outputText: '...', parsed: { stage_verdict: 'strong', summary: 'Consistent.' } })
  );

  fs.writeFileSync(
    path.join(root, idB, 'info.json'),
    JSON.stringify({ mode: 'mock', practiceStage: null, startedAt: '2026-09-12T09:00:00.000Z' })
  );
  fs.writeFileSync(
    path.join(root, idB, 'cost-summary.json'),
    JSON.stringify({ outcome: 'finished', endedAt: '2026-09-12T09:05:00.000Z', totals: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 } })
  );

  const mock = makeMockCallModel();
  const server = createServer({ callModel: mock.callModel, config: loadStageOrder(), traceDir: root });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const list = await get(base, '/api/traces');
  assert.equal(list.status, 200);
  assert.equal(list.body.traces.length, 2);
  assert.equal(list.body.traces[0].sessionId, idB, 'newest session first');
  assert.equal(list.body.traces[0].verdict, null);
  assert.equal(list.body.traces[1].sessionId, idA);
  assert.equal(list.body.traces[1].verdict, 'strong');
  assert.equal(list.body.traces[1].durationSec, 90);

  const detail = await get(base, '/api/traces/' + idA);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.info.mode, 'practice');
  assert.equal(detail.body.calls.length, 3);
  assert.equal(detail.body.timeline.length, 4, 'classify call is filtered out of the timeline');
  assert.equal(detail.body.timeline[0].type, 'question');
  assert.equal(detail.body.timeline[1].type, 'answer');
  assert.equal(detail.body.stats.questions, 1);
  assert.equal(detail.body.stats.verdicts.strong, 1);
  assert.equal(detail.body.verdict, 'strong');

  const missing = await get(base, '/api/traces/does-not-exist-000');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.ok, false);

  const traversal = await get(base, '/api/traces/..%2F..%2Fserver');
  assert.equal(traversal.status, 404);
});

test('trace list is empty when no sessions are traced', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-empty-server-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const mock = makeMockCallModel();
  const server = createServer({ callModel: mock.callModel, config: loadStageOrder(), traceDir: root });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const list = await get(base, '/api/traces');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.traces, []);
});

test('active sessions are listed and resumable with a transcript', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();

  const started = await post(base, '/api/start', { mode: 'practice', stage: 'behavioral' });
  const sessionId = started.body.sessionId;

  const listed = await get(base, '/api/sessions');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.sessions.length, 1);
  assert.equal(listed.body.sessions[0].sessionId, sessionId);
  assert.equal(listed.body.sessions[0].stage, 'behavioral');
  assert.equal(listed.body.sessions[0].answers, 0);
  assert.equal(listed.body.sessions[0].awaiting, 'answer');

  await post(base, '/api/answer', { sessionId, answer: 'I rallied a cross-functional team without authority.' });

  const resumed = await get(base, '/api/sessions/' + sessionId);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.state, 'question');
  assert.ok(resumed.body.question.text.length > 0);
  assert.equal(resumed.body.stage.name, 'behavioral');
  const types = resumed.body.transcript.map((e) => e.type);
  assert.deepEqual(types, ['question', 'answer', 'judge']);
  assert.match(resumed.body.transcript[0].text, /formal authority/);
  assert.equal(resumed.body.transcript[1].text, 'I rallied a cross-functional team without authority.');
  assert.equal(resumed.body.transcript[2].verdict, 'strong');

  const listed2 = await get(base, '/api/sessions');
  assert.equal(listed2.body.sessions[0].answers, 1);

  const missing = await get(base, '/api/sessions/does-not-exist-000');
  assert.equal(missing.status, 404);
});

test('finished sessions are not listed as resumable', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();

  const done = store.createSession({ mode: 'practice', practiceStage: 'case_study' });
  done.awaiting = 'final_report';
  store.saveSession(done.id);

  const listed = await get(base, '/api/sessions');
  assert.deepEqual(listed.body.sessions, []);
  const resumed = await get(base, '/api/sessions/' + done.id);
  assert.equal(resumed.status, 404);
});

test('mock resume transcript hides per-answer judge output', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();

  const started = await post(base, '/api/start', { mode: 'mock' });
  let sessionId = started.body.sessionId;
  await post(base, '/api/answer', { sessionId, answer: 'Small talk.' });
  await post(base, '/api/answer', { sessionId, answer: 'More small talk.' });
  await post(base, '/api/answer', { sessionId, answer: 'I led a project without formal authority.' });

  const resumed = await get(base, '/api/sessions/' + sessionId);
  assert.equal(resumed.status, 200);
  const types = resumed.body.transcript.map((e) => e.type);
  assert.ok(types.includes('answer'), 'answers replay on resume');
  assert.ok(!types.includes('judge'), 'mock resume must not leak per-answer judge output');
});

test('simulation practice resume transcript hides per-answer judge output', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();
  candidateStore.clearCandidates();

  const started = await post(base, '/api/start', { mode: 'practice', stage: 'behavioral', feedback: 'simulation' });
  const sessionId = started.body.sessionId;
  await post(base, '/api/answer', { sessionId, answer: 'I led a project without formal authority.' });

  const resumed = await get(base, '/api/sessions/' + sessionId);
  assert.equal(resumed.status, 200);
  const types = resumed.body.transcript.map((e) => e.type);
  assert.ok(!types.includes('judge'), 'simulation resume must not leak per-answer judge output');
  assert.ok(!types.includes('stage_verdict'), 'no verdict leaks before the round ends');
});

test('rate-limit engine failures produce a friendly message', async (t) => {
  const mock = makeMockCallModel();
  const orig = mock.callModel;
  mock.callModel = async (prompt) => {
    if (prompt.includes('You are grading')) throw new Error('cohere API responded 429: rate limited');
    return orig(prompt);
  };
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();

  const started = await post(base, '/api/start', { mode: 'practice', stage: 'behavioral' });
  const res = await post(base, '/api/answer', { sessionId: started.body.sessionId, answer: 'hi' });
  assert.equal(res.status, 502);
  assert.match(res.body.error, /rate-limited/);
  assert.match(res.body.error, /send your answer again/);
});

test('practice rounds accumulate a candidate profile and coverage across sessions', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();
  candidateStore.clearCandidates();

  const r1 = await post(base, '/api/start', {
    mode: 'practice',
    stage: 'behavioral',
    targetRole: 'Senior PM',
    resume: 'Led payments at a fintech.',
  });
  assert.equal(r1.status, 200);
  assert.ok(r1.body.candidate, 'practice start returns candidate context');
  const candidateId = r1.body.candidate.id;
  assert.equal(r1.body.candidate.total, 7);
  assert.equal(r1.body.candidate.done, false);
  assert.equal(r1.body.candidate.roundsPlayed, 0);

  let sessionId = r1.body.sessionId;
  let final1;
  let guard = 0;
  while (true) {
    const a = await post(base, '/api/answer', { sessionId, answer: 'I rally product, eng, and design without formal authority.' });
    assert.equal(a.status, 200);
    if (a.body.state === 'final_report') {
      final1 = a.body;
      break;
    }
    guard += 1;
    assert.ok(guard < 30, 'round 1 did not finish');
  }
  assert.deepEqual(final1.candidate.coveredStages, ['behavioral']);
  assert.equal(final1.candidate.roundsPlayed, 1);

  const listed = await get(base, '/api/candidates');
  assert.equal(listed.status, 200);
  assert.ok(listed.body.candidates.some((c) => c.id === candidateId && c.coveredStages.includes('behavioral')));

  const r2 = await post(base, '/api/start', { mode: 'practice', stage: 'estimation', candidateId });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.candidate.id, candidateId);
  assert.deepEqual(r2.body.candidate.coveredStages, ['behavioral'], 'round 2 sees the round 1 coverage');

  const a2 = await post(base, '/api/answer', { sessionId: r2.body.sessionId, answer: 'Assuming 8 billion people, here is the estimate.' });
  assert.equal(a2.status, 200);
  const judgeWithProfile = mock.prompts.find(
    (p) => p.includes('You are grading a candidate') && p.includes('tests assumptions before committing')
  );
  assert.ok(judgeWithProfile, 'round 2 judge sees the profile note written in round 1');
});

test('simulation rounds withhold per-answer feedback but still reveal the round verdict', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();
  candidateStore.clearCandidates();

  const started = await post(base, '/api/start', {
    mode: 'practice',
    stage: 'behavioral',
    feedback: 'simulation',
  });
  assert.equal(started.status, 200);

  let sessionId = started.body.sessionId;
  let final;
  let guard = 0;
  while (true) {
    const a = await post(base, '/api/answer', { sessionId, answer: 'Structured answer.' });
    assert.equal(a.status, 200);
    if (a.body.state === 'final_report') {
      final = a.body;
      break;
    }
    assert.equal(a.body.feedback, null, 'simulation mode hides per-answer feedback');
    guard += 1;
    assert.ok(guard < 30, 'simulation round did not finish');
  }

  assert.equal(final.feedback, null, 'simulation hides the final per-answer feedback too');
  assert.equal(final.report.stageVerdicts.length, 1, 'the round verdict is still produced');
  assert.ok(final.candidate, 'round results still attach to the candidate');
});

test('debrief endpoint synthesizes an overall report across accumulated verdicts', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();
  candidateStore.clearCandidates();

  const created = await post(base, '/api/candidates', { targetRole: 'Senior PM', resume: 'B2B SaaS' });
  assert.equal(created.status, 200);
  const candidateId = created.body.candidate.id;

  const cand = candidateStore.getCandidate(candidateId);
  cand.stageVerdicts = [
    { stage: 'behavioral', verdict: { stage_verdict: 'strong', summary: 'leading stories' } },
    { stage: 'estimation', verdict: { stage_verdict: 'developing', summary: 'decent math' } },
  ];
  cand.coveredStages = ['behavioral', 'estimation'];

  const debrief = await post(base, '/api/debrief', { candidateId });
  assert.equal(debrief.status, 200);
  assert.equal(debrief.body.debrief.report.overall_verdict, 'strong');
  assert.equal(debrief.body.candidate.hasDebrief, true);

  const detail = await get(base, '/api/candidates/' + encodeURIComponent(candidateId));
  assert.equal(detail.status, 200);
  assert.ok(detail.body.candidate.debriefReport, 'candidate detail includes the stored debrief');
  assert.equal(detail.body.candidate.debriefReport.report.overall_verdict, 'strong');
});

test('completing all graded rounds auto-runs the candidate debrief', async (t) => {
  const mock = makeMockCallModel();
  const { server, base } = await boot(mock);
  t.after(() => server.close());
  store.clearSessions();
  candidateStore.clearCandidates();

  async function playRound(stage, candidateId) {
    const started = await post(base, '/api/start', { mode: 'practice', stage, candidateId });
    assert.equal(started.status, 200);
    let sessionId = started.body.sessionId;
    let final;
    let guard = 0;
    while (true) {
      const a = await post(base, '/api/answer', {
        sessionId,
        answer: 'I would structure this with clear reasoning and explicit assumptions.',
      });
      assert.equal(a.status, 200);
      if (a.body.state === 'final_report') {
        final = a.body;
        break;
      }
      guard += 1;
      assert.ok(guard < 40, 'round did not finish');
    }
    return final;
  }

  const first = await playRound('behavioral', null);
  const candidateId = first.candidate.id;

  for (const s of ['estimation', 'product_design', 'case_study', 'strategy', 'execution_metrics']) {
    await playRound(s, candidateId);
  }
  const last = await playRound('technical', candidateId);

  assert.equal(last.candidate.done, true);
  assert.ok(last.debrief, 'auto-debrief ran when the last graded stage was covered');
  assert.equal(last.debrief.report.overall_verdict, 'strong');

  const detail = await get(base, '/api/candidates/' + encodeURIComponent(candidateId));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.candidate.coveredStages.length, 7);
  const expected = new Set(rounds.gradedStages(loadStageOrder()).map((s) => s.name));
  assert.deepEqual(new Set(detail.body.candidate.coveredStages), expected);
  assert.equal(detail.body.candidate.debriefReport.report.cross_stage_patterns.length > 0, true);
});