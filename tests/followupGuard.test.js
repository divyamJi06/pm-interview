const test = require('node:test');
const assert = require('node:assert/strict');

const { loadStageOrder } = require('../server/config/stageOrder');
const { makeDeps, begin, processAnswer } = require('../server/lib/interview');
const { loadStage } = require('../server/lib/loadStage');
const store = require('../server/lib/sessionStore');

function judgeOutput(verdict = 'developing') {
  return {
    dimension_scores: { quality: 3 },
    green_flags_hit: [],
    red_flags_hit: [],
    summary: 'Shallow on the dimension the intent cares about.',
    overall_verdict: verdict,
  };
}

function makeCallModel(policy = 'per_question_probe') {
  return async function callModel(prompt) {
    if (prompt.includes('You are grading a candidate')) return judgeOutput();
    if (prompt.includes('deciding what happens next')) {
      if (policy === 'next_question_forever') {
        return { decision: 'next_question', reasoning: 'keep going' };
      }
      if (policy === 'end_interview_forever') {
        return { decision: 'end_interview', reasoning: 'wrap now' };
      }
      const match = /Questions asked: (\d+) \/ (\d+)/.exec(prompt);
      const wasFu = /LAST ANSWER WAS A FOLLOW-UP ANSWER:\s*(\w+)/.exec(prompt)?.[1] === 'true';
      const asked = match ? Number(match[1]) : 0;
      const max = match ? Number(match[2]) : 0;
      const fuQ = Number(/Follow-ups asked on this question so far: (\d+)/.exec(prompt)?.[1] || 0);
      if (policy === 'followup_forever') {
        return { decision: 'follow_up', follow_up_question: 'Why?', reasoning: 'keep probing' };
      }
      if (!wasFu && fuQ < 2) {
        return { decision: 'follow_up', follow_up_question: 'Why did you choose that route?', reasoning: 'probe depth' };
      }
      if (asked < max) {
        return { decision: 'next_question', reasoning: 'covered enough' };
      }
      return { decision: 'end_interview', reasoning: 'question budget spent' };
    }
    if (prompt.includes('writing a stage-level verdict')) {
      return { stage_verdict: 'developing', summary: 'ok', strengths: [], gaps: [] };
    }
    if (prompt.includes('You are coaching a PM interview candidate')) {
      return { action_plan: [], priority_order: [] };
    }
    throw new Error('Mock callModel got an unexpected prompt:\n' + prompt.slice(0, 300));
  };
}

function stubbedBehavioral(questions) {
  return {
    name: 'behavioral',
    mode: 'dimension',
    rubric: loadStage('behavioral').rubric,
    questions,
  };
}

function bootDeps(policy) {
  return makeDeps({ callModel: makeCallModel(policy), config: loadStageOrder() });
}

test('follow-ups are Director-driven: no fixed budget, and the system turn guard ends a runaway stage', async () => {
  store.clearSessions();
  const session = store.createSession({ mode: 'practice', practiceStage: 'behavioral' });
  const deps = bootDeps('followup_forever');
  begin(session, deps);

  let last;
  for (let i = 0; i < 12; i++) {
    last = await processAnswer({ session, answerText: `answer ${i}`, deps });
    if (last.state === 'final_report') break;
    assert.equal(last.state, 'follow_up');
  }
  assert.equal(last.state, 'final_report', 'runaway follow-ups terminate via the system turn guard');
  assert.ok(session.followUpsUsed >= 5, 'more follow-ups were asked than any fixed per-stage budget ever allowed');
  assert.equal(last.report.stageVerdicts.length, 1);
});

test('the follow-up count is tracked per question and resets on the next main question', async () => {
  store.clearSessions();
  const session = store.createSession({ mode: 'practice', practiceStage: 'behavioral' });
  const deps = bootDeps('per_question_probe');
  begin(session, deps);

  const a1 = await processAnswer({ session, answerText: 'First answer.', deps });
  assert.equal(a1.state, 'follow_up');
  assert.equal(a1.stageProgress.followUpsUsed, 1);
  assert.equal(a1.stageProgress.followUpsThisQuestion, 1);

  const a2 = await processAnswer({ session, answerText: 'Answering the follow-up.', deps });
  assert.equal(a2.state, 'question', 'after a follow-up answer the Director moves to the next main question');
  assert.equal(a2.question.isFollowUp, false);
  assert.equal(a2.stageProgress.followUpsUsed, 1);
  assert.equal(a2.stageProgress.followUpsThisQuestion, 0, 'per-question count resets on a new main question');

  const a3 = await processAnswer({ session, answerText: 'Second main answer.', deps });
  assert.equal(a3.state, 'follow_up');
  assert.equal(a3.stageProgress.followUpsUsed, 2);
  assert.equal(a3.stageProgress.followUpsThisQuestion, 1);

  const a4 = await processAnswer({ session, answerText: 'Answering the second follow-up.', deps });
  assert.equal(a4.state, 'final_report');
  assert.equal(a4.report.stageVerdicts.length, 1);
});

test('the Director cannot re-ask a question: exhausting the bank ends the round', async () => {
  store.clearSessions();
  const session = store.createSession({ mode: 'practice', practiceStage: 'behavioral' });
  const deps = makeDeps({
    callModel: makeCallModel('next_question_forever'),
    config: loadStageOrder(),
    loadStageFn: () => stubbedBehavioral(['Question A?', 'Question B?']),
    rng: () => 0,
  });
  begin(session, deps);

  let last;
  for (let i = 0; i < 6; i++) {
    last = await processAnswer({ session, answerText: `answer ${i}`, deps });
    if (last.state === 'final_report') break;
  }
  assert.equal(last.state, 'final_report', 'the round ends once the bank is spent');
  const questions = (session.triples.get('behavioral') || []).map((t) => t.question);
  assert.deepEqual(questions, ['Question A?', 'Question B?']);
  assert.equal(new Set(questions).size, 2, 'no question was asked twice');
});

test('a stage is not forced below its minimum when the bank is already spent', async () => {
  store.clearSessions();
  const session = store.createSession({ mode: 'practice', practiceStage: 'behavioral' });
  const deps = makeDeps({
    callModel: makeCallModel('end_interview_forever'),
    config: loadStageOrder(),
    loadStageFn: () => stubbedBehavioral(['Only question?']),
  });
  begin(session, deps);

  const a1 = await processAnswer({ session, answerText: 'Only answer.', deps });
  assert.equal(a1.state, 'final_report', 'no forced-ask loop when the bank cannot satisfy the minimum');
  assert.equal((session.triples.get('behavioral') || []).length, 1);
});