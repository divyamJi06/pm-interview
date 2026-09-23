const test = require('node:test');
const assert = require('node:assert/strict');

const { loadStageOrder } = require('../server/config/stageOrder');
const { makeDeps, begin, processAnswer, processClarify, classifyTurn, formatTriples } = require('../server/lib/interview');
const store = require('../server/lib/sessionStore');

function judgeOutput() {
  return {
    checklist_hits: { 'Make an equation': true },
    dimension_scores: { quality: 4 },
    green_flags_hit: [],
    red_flags_hit: [],
    summary: 'Solid answer.',
    overall_verdict: 'strong',
  };
}

function makeCallModel(prompts, options = {}) {
  const clarify = options.clarify || (() => ({ answer: 'Assume ~8 billion people worldwide.', wrap_up: false }));
  const classify = options.classify;
  return async function callModel(prompt) {
    prompts.push(prompt);
    if (prompt.includes('You are grading a candidate')) return judgeOutput();
    if (prompt.includes('deciding what happens next')) {
      const asked = /Questions asked: (\d+) \/ (\d+)/.exec(prompt);
      const last = /IS THIS THE LAST STAGE OF THE INTERVIEW:\s*(\w+)/.exec(prompt);
      if (asked && Number(asked[1]) >= Number(asked[2]) && last?.[1] === 'true') {
        return { decision: 'end_interview', reasoning: 'scripted' };
      }
      return { decision: 'next_question', reasoning: 'scripted' };
    }
    if (prompt.includes('You are the interviewer in a PM mock interview')) return clarify(prompt);
    if (prompt.includes('You are routing messages')) return { type: classify || 'answer' };
    if (prompt.includes('writing a stage-level verdict')) return { stage_verdict: 'strong', summary: 'ok', strengths: [], gaps: [] };
    if (prompt.includes('You are coaching a PM interview candidate')) return { action_plan: [], priority_order: [] };
    throw new Error('Mock callModel got an unexpected prompt:\n' + prompt.slice(0, 300));
  };
}

function bootDeps(prompts, options) {
  return makeDeps({ callModel: makeCallModel(prompts, options), config: loadStageOrder() });
}

test('a clarifying question is answered, fed to the judge, and attached to the triple', async () => {
  store.clearSessions();
  const prompts = [];
  const session = store.createSession({ mode: 'practice', practiceStage: 'estimation' });
  const deps = bootDeps(prompts);
  begin(session, deps);

  const c = await processClarify({ session, clarifyText: 'What population should I assume?', deps });
  assert.equal(c.state, 'clarify_reply');
  assert.equal(c.clarifyAnswer, 'Assume ~8 billion people worldwide.');
  assert.equal(c.wrapUp, false);
  assert.equal(c.question.isFollowUp, false);
  assert.equal(session.pendingClarifications.length, 1);
  assert.equal(session.stageClarifications, 1);

  const a = await processAnswer({ session, answerText: 'Assuming 8 billion, here is the estimate.', deps });
  assert.equal(a.state, 'final_report');
  assert.equal(session.pendingClarifications.length, 0, 'clarifications are consumed by the answer');

  const triple = (session.triples.get('estimation') || [])[0];
  assert.ok(triple, 'a triple was recorded');
  assert.equal(triple.clarifications.length, 1);
  assert.equal(triple.clarifications[0].candidateQuestion, 'What population should I assume?');

  const judgePrompt = prompts.find((p) => p.includes('You are grading a candidate'));
  assert.ok(judgePrompt.includes('CLARIFYING EXCHANGE BEFORE THE ANSWER'));
  assert.match(judgePrompt, /What population should I assume/);

  const directorPrompt = prompts.find((p) => p.includes('deciding what happens next'));
  assert.match(directorPrompt, /Clarifying questions asked this stage: 1/);

  const synthPrompt = prompts.find((p) => p.includes('writing a stage-level verdict'));
  assert.match(synthPrompt, /Candidate's clarifying questions before answering/);
  assert.match(synthPrompt, /What population should I assume/);

  const formatted = formatTriples(session.triples.get('estimation'));
  assert.match(formatted, /What population should I assume/);
});

test('clarifying is capped per question: the interviewer refuses past the cap', async () => {
  store.clearSessions();
  const session = store.createSession({ mode: 'practice', practiceStage: 'behavioral' });
  const deps = bootDeps([], { clarify: () => ({ answer: 'Sure.', wrap_up: false }) });
  begin(session, deps);

  for (let i = 0; i < 3; i++) {
    const c = await processClarify({ session, clarifyText: `Clarify ${i}`, deps });
    assert.equal(c.state, 'clarify_reply', `clarify ${i} was allowed`);
  }
  assert.equal(session.pendingClarifications.length, 3);
  assert.equal(session.clarifyPhaseEnded, false);

  await assert.rejects(
    () => processClarify({ session, clarifyText: 'One more?', deps }),
    /has asked you to answer now/
  );
});

test('the interviewer never wraps up on the very first clarifying question, and a wrap-up refuses further clarifiers', async () => {
  store.clearSessions();
  const session = store.createSession({ mode: 'practice', practiceStage: 'behavioral' });
  const deps = bootDeps([], { clarify: () => ({ answer: 'Good question - just assume it.', wrap_up: true }) });
  begin(session, deps);

  const c1 = await processClarify({ session, clarifyText: 'What are the constraints?', deps });
  assert.equal(c1.wrapUp, false, 'no wrap-up before a couple of clarifying questions');
  assert.equal(session.clarifyPhaseEnded, false);

  const c2 = await processClarify({ session, clarifyText: 'And the audience?', deps });
  assert.equal(c2.wrapUp, true);
  assert.equal(session.clarifyPhaseEnded, true);

  await assert.rejects(
    () => processClarify({ session, clarifyText: 'One more question?', deps }),
    /has asked you to answer now/
  );
});

test('the system stops clarifying when the active time budget is exhausted', async () => {
  store.clearSessions();
  const session = store.createSession({ mode: 'practice', practiceStage: 'behavioral' });
  const deps = bootDeps([]);
  begin(session, deps);
  session.createdAt = Date.now() - 95 * 60 * 1000;
  session.lastActivityAt = Date.now() - 60 * 1000;

  await assert.rejects(
    () => processClarify({ session, clarifyText: 'Any defaults?', deps }),
    /Time is up/
  );
});

test('idle time does not count against the interview clock', async () => {
  store.clearSessions();
  const session = store.createSession({ mode: 'practice', practiceStage: 'behavioral' });
  const deps = bootDeps([]);
  begin(session, deps);
  session.createdAt = Date.now() - 95 * 60 * 1000;
  session.lastActivityAt = Date.now() - 95 * 60 * 1000;

  const c = await processClarify({ session, clarifyText: 'Any defaults?', deps });
  assert.equal(c.state, 'clarify_reply', 'a long gap since last activity is treated as idle, not interview time');
});

test('clarifying is not available in ungraded stages like the greeting', async () => {
  store.clearSessions();
  const session = store.createSession({ mode: 'practice', practiceStage: 'greeting' });
  const deps = bootDeps([]);
  begin(session, deps);

  await assert.rejects(
    () => processClarify({ session, clarifyText: 'What should I cover?', deps }),
    /aren't available/
  );
});

test('classifyTurn routes a message to clarify or answer', async () => {
  store.clearSessions();
  const prompts = [];
  const session = store.createSession({ mode: 'practice', practiceStage: 'behavioral' });
  const deps = bootDeps(prompts, { classify: 'clarify' });
  begin(session, deps);

  const kind = await classifyTurn({ deps, session, text: 'What population should I assume?' });
  assert.equal(kind, 'clarify');
  assert.ok(prompts.some((p) => p.includes('You are routing messages')), 'the classifier was consulted');

  const longAnswer = 'I would start by agreeing on the problem scope, then estimate the addressable market, then sanity-check the whole pipeline against a known benchmark before committing to a number.';
  const longKind = await classifyTurn({ deps, session, text: longAnswer });
  assert.equal(longKind, 'answer', 'long answers skip the model call entirely');
});

test('classifyTurn falls back to a heuristic when the model call fails', async () => {
  store.clearSessions();
  const session = store.createSession({ mode: 'practice', practiceStage: 'behavioral' });
  const deps = makeDeps({
    callModel: async () => { throw new Error('API down'); },
    config: loadStageOrder(),
  });
  begin(session, deps);

  assert.equal(await classifyTurn({ deps, session, text: 'Do you mean the whole country?' }), 'clarify');
  assert.equal(await classifyTurn({ deps, session, text: 'Here is my answer.' }), 'answer');
});

test('short messages classify without a model call', async () => {
  store.clearSessions();
  const prompts = [];
  const session = store.createSession({ mode: 'practice', practiceStage: 'behavioral' });
  const deps = bootDeps(prompts, { classify: 'answer' });
  begin(session, deps);

  assert.equal(await classifyTurn({ deps, session, text: 'Uh huh.' }), 'answer');
  assert.equal(await classifyTurn({ deps, session, text: 'Really?' }), 'clarify');
  assert.equal(await classifyTurn({ deps, session, text: 'On the whole country?' }), 'clarify');
  assert.ok(!prompts.some((p) => p.includes('You are routing messages')), 'short inputs skip the classifier model call');
});