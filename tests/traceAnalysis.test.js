const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ta = require('../server/lib/traceAnalysis');

function call(seq, label, { parsed = {}, prompt = '', outputText = '', success = true } = {}) {
  return { seq, label, role: ta.splitLabel(label).role, stage: ta.splitLabel(label).stage, success, prompt, outputText, parsed };
}

function judgePrompt(question, answer) {
  return [
    'You are grading a candidate in a PM interview.',
    `QUESTION ASKED: ${question}`,
    'CLARIFYING EXCHANGE BEFORE THE ANSWER',
    `CANDIDATE'S ANSWER: ${answer}`,
    'Weigh the clarifying exchange',
  ].join('\n');
}

function clarifyPrompt(question, candidateQuestion) {
  return [
    'You are the interviewer in a PM mock interview.',
    `THE QUESTION THE CANDIDATE IS ANSWERING: ${question}`,
    `THE CANDIDATE'S CLARIFYING QUESTION: ${candidateQuestion}`,
    "WHAT'S KNOWN ABOUT THIS CANDIDATE: prefers structure",
  ].join('\n');
}

test('splitLabel parses role and stage from call labels', () => {
  assert.deepEqual(ta.splitLabel('director-clarify-estimation'), { role: 'director-clarify', stage: 'estimation' });
  assert.deepEqual(ta.splitLabel('judge-behavioral'), { role: 'judge', stage: 'behavioral' });
  assert.deepEqual(ta.splitLabel('synthesizer-interview'), { role: 'synthesizer-interview', stage: '' });
  assert.deepEqual(ta.splitLabel('classify-turn'), { role: 'classify', stage: '' });
  assert.deepEqual(ta.splitLabel('something-else'), { role: 'model_call', stage: '' });
});

test('buildTimeline reconstructs transcript and skips classify calls', () => {
  const timeline = ta.buildTimeline([
    call(1, 'classify-turn', {}),
    call(2, 'judge-estimation', {
      prompt: judgePrompt('How many cups of coffee sold in Seattle daily?', 'About 2.7 million, assuming one per adult per day.'),
      parsed: { overall_verdict: 'strong', summary: 'Clear assumptions.', green_flags_hit: ['assumption'] },
    }),
    call(3, 'profile-estimation', { parsed: { updated_profile: ['comfortable with scoping'] } }),
    call(4, 'director-estimation', { parsed: { decision: 'next_question', reasoning: 'time is fine' } }),
    call(5, 'synthesizer-stage-estimation', { parsed: { stage_verdict: 'strong', summary: 'Good estimation work.', strengths: ['math'], gaps: [] } }),
  ]);

  assert.equal(timeline[0].type, 'question');
  assert.equal(timeline[0].stage, 'estimation');
  assert.match(timeline[0].text, /cups of coffee/);
  assert.equal(timeline[1].type, 'answer');
  assert.match(timeline[1].text, /2.7 million/);
  assert.equal(timeline[2].type, 'judge');
  assert.equal(timeline[2].verdict, 'strong');
  assert.equal(timeline[3].type, 'profile');
  assert.equal(timeline[4].type, 'director');
  assert.equal(timeline[4].decision, 'next_question');
  assert.equal(timeline[5].type, 'stage_verdict');
  assert.equal(timeline.length, 6, 'classify call must not appear');
});

test('buildTimeline captures clarifying exchange with wrap_up and dedupes questions', () => {
  const mainQuestion = 'Estimate the market size for dog food in the US.';
  const followUpQuestion = 'Which segment would you tackle first, and why?';
  const timeline = ta.buildTimeline([
    call(1, 'classify-turn', {}),
    call(2, 'director-clarify-estimation', {
      prompt: clarifyPrompt(mainQuestion, 'Nationwide or just urban areas?'),
      parsed: { answer: 'Consider nationwide, roughly $5B.', wrap_up: true },
    }),
    call(3, 'judge-estimation', {
      prompt: judgePrompt(mainQuestion, 'Assume $5B nationwide, driven by ~90M dogs.'),
      parsed: { overall_verdict: 'developing', summary: 'Need clearer math.' },
    }),
    call(4, 'director-estimation', {
      parsed: { decision: 'follow_up', follow_up_question: followUpQuestion, reasoning: 'did not show unit economics' },
    }),
    call(5, 'judge-estimation', {
      prompt: judgePrompt(followUpQuestion, 'I would start with premium dry food for urban owners.'),
      parsed: { overall_verdict: 'weak', summary: 'Ran out of structure.' },
    }),
    call(6, 'synthesizer-interview', {
      parsed: {
        overall_verdict: 'developing',
        summary: 'Mixed performance.',
        top_things_to_work_on: ['show math'],
        recommended_resources: [{ title: 'Thinking in Bets — Annie Duke', type: 'book', why: 'judgment under uncertainty' }],
      },
    }),
  ]);

  const qs = timeline.filter((e) => e.type === 'question');
  assert.equal(qs.length, 2, 'main question emitted once, follow-up emitted as its own question');
  assert.equal(qs[0].text, mainQuestion);
  assert.equal(qs[1].text, followUpQuestion);

  const ctx = timeline.find((e) => e.type === 'clarify');
  assert.equal(ctx.candidateQuestion, 'Nationwide or just urban areas?');
  assert.equal(ctx.interviewerAnswer, 'Consider nationwide, roughly $5B.');
  assert.equal(ctx.wrapUp, true);
  assert.equal(ctx.question, mainQuestion);

  assert.equal(timeline.filter((e) => e.type === 'answer').length, 2);
  const fr = timeline[timeline.length - 1];
  assert.equal(fr.type, 'final_report');
  assert.equal(fr.recommendedResources.length, 1);
  assert.equal(fr.recommendedResources[0].title, 'Thinking in Bets — Annie Duke');
});

test('timelineStats counts answers, clarifications, follow-ups and verdicts', () => {
  const timeline = [
    { type: 'question', text: 'A' },
    { type: 'answer', text: 'AAAAAAAAAA' },
    { type: 'clarify', candidateQuestion: 'Huh?' },
    { type: 'director', decision: 'follow_up' },
    { type: 'answer', text: 'BBBB' },
    { type: 'judge', verdict: 'strong' },
    { type: 'director', decision: 'next_question' },
    { type: 'answer', text: 'CCCCC' },
    { type: 'judge', verdict: 'developing' },
  ];
  const stats = ta.timelineStats(timeline);
  assert.equal(stats.questions, 1);
  assert.equal(stats.answers, 3);
  assert.equal(stats.clarifications, 1);
  assert.equal(stats.followUpsAsked, 1);
  assert.equal(stats.decisions.follow_up, 1);
  assert.equal(stats.decisions.next_question, 1);
  assert.equal(stats.verdicts.strong, 1);
  assert.equal(stats.verdicts.developing, 1);
  assert.equal(stats.avgAnswerChars, Math.round((10 + 4 + 5) / 3));
});

test('readTrace and listTraces read session files and sort newest first', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-analysis-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const idA = 'aaa-1111-2222-3333-444444444444';
  const idB = 'bbb-1111-2222-3333-444444444444';
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
  fs.writeFileSync(
    path.join(root, idA, 'calls', '0001.json'),
    JSON.stringify({
      seq: 1,
      label: 'judge-estimation',
      success: true,
      prompt: judgePrompt('How big is the coffee market?', 'About $40B.'),
      outputText: '',
      parsed: { overall_verdict: 'strong', summary: 'Good.' },
    })
  );
  fs.writeFileSync(
    path.join(root, idA, 'calls', '0002-synthesizer-stage-estimation.json'),
    JSON.stringify({ seq: 2, label: 'synthesizer-stage-estimation', success: true, prompt: 'You are writing a stage-level verdict...', outputText: '', parsed: { stage_verdict: 'strong', summary: 'Consistent.' } })
  );

  fs.writeFileSync(
    path.join(root, idB, 'info.json'),
    JSON.stringify({ mode: 'mock', practiceStage: null, startedAt: '2026-09-12T09:00:00.000Z' })
  );
  fs.writeFileSync(
    path.join(root, idB, 'cost-summary.json'),
    JSON.stringify({ outcome: 'failed', endedAt: '2026-09-12T09:05:00.000Z', totals: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 } })
  );

  const list = ta.listTraces(root);
  assert.equal(list.length, 2, 'dirs that are not valid sessions are skipped');
  assert.equal(list[0].sessionId, idB, 'newest session first');
  assert.equal(list[0].verdict, null);
  assert.equal(list[0].durationSec, 300);
  assert.equal(list[0].costUsd, 0);
  assert.equal(list[1].verdict, 'strong');
  assert.equal(list[1].durationSec, 90);
  assert.equal(list[1].outcome, 'finished');

  const trace = ta.readTrace(root, idA);
  assert.equal(trace.info.mode, 'practice');
  assert.equal(trace.calls.length, 2);
  assert.equal(trace.verdict, 'strong');
  assert.equal(trace.timeline[0].type, 'question');
  assert.equal(trace.timeline[1].type, 'answer');
  assert.equal(trace.timeline[0].text, 'How big is the coffee market?');

  const cls = ta.readTrace(root, 'not-a-real-session-id');
  assert.equal(cls, null);
});

test('listTraces returns [] when dir is missing or empty', () => {
  assert.deepEqual(ta.listTraces(path.join(os.tmpdir(), 'nope-' + Date.now())), []);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-empty-'));
  assert.deepEqual(ta.listTraces(empty), []);
  fs.rmSync(empty, { recursive: true, force: true });
});