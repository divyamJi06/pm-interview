const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCoachPrompt,
  runCoach,
  formatTranscriptExcerpts,
} = require('../server/lib/coach');
const { loadResourceBank, formatResourceBank } = require('../server/lib/resourceBank');

function debriefOutput() {
  return {
    overall_verdict: 'developing',
    summary: 'Structured but slow to commit.',
    cross_stage_patterns: [],
    top_things_to_work_on: ['commit to a decision'],
  };
}

test('buildCoachPrompt fills every template slot and no placeholders remain', () => {
  const prompt = buildCoachPrompt({
    debriefOutput: debriefOutput(),
    candidateProfile: ['hesitates under uncertainty'],
    transcriptExcerpts: [
      {
        stage: 'behavioral',
        triples: [
          {
            question: 'Tell me about a hard call you made.',
            answer: 'I weighed options and it worked out.',
            isFollowUp: false,
            clarifications: [],
            judge: { overall_verdict: 'developing', summary: 'No clear decision.' },
          },
        ],
      },
    ],
    coachingBank: formatResourceBank(loadResourceBank()),
  });

  assert.ok(prompt.includes('You are coaching a PM interview candidate'));
  assert.ok(prompt.includes('"overall_verdict": "developing"'), 'verdict and gaps JSON is embedded');
  assert.ok(prompt.includes('hesitates under uncertainty'), 'candidate profile is embedded');
  assert.ok(prompt.includes('--- STAGE: behavioral ---'), 'transcript excerpts are organized per stage');
  assert.ok(prompt.includes('Tell me about a hard call you made.'));
  assert.ok(prompt.includes('I weighed options and it worked out.'));
  assert.ok(prompt.includes('How it was graded:'), 'judge output is embedded with the answer');
  assert.ok(!prompt.includes('{{'), 'no unfilled template placeholders remain');
});

test('formatTranscriptExcerpts includes clarifications and follow-ups', () => {
  const out = formatTranscriptExcerpts([
    {
      stage: 'estimation',
      triples: [
        {
          question: 'Size the coffee market.',
          answer: 'Assuming 8 billion people...',
          isFollowUp: false,
          clarifications: [
            { candidateQuestion: 'Which country?', interviewerAnswer: 'Any one - pick.', },
          ],
          judge: { overall_verdict: 'strong' },
        },
        {
          question: 'And what could shift it?',
          answer: 'New entrants.',
          isFollowUp: true,
          clarifications: [],
          judge: null,
        },
      ],
    },
  ]);
  assert.match(out, /Follow-up: And what could shift it\?/);
  assert.match(out, /Candidate's clarifying questions before answering/);
  assert.match(out, /Which country\?/);
});

test('runCoach parses and normalizes the model output', async () => {
  const calls = [];
  const result = await runCoach({
    call: async (prompt, opts) => {
      calls.push({ prompt, opts });
      return {
        preamble: 'ignored',
        action_plan: [
          { gap: 'g1', why_it_matters: 'm', how_to_practice: 'p', try_this_next_time: 't', resource: null },
        ],
        priority_order: ['g1'],
      };
    },
    debriefOutput: debriefOutput(),
    candidateProfile: [],
    transcriptExcerpts: [],
    coachingBank: '(no curated resource bank configured)',
  });

  assert.deepEqual(result, {
    action_plan: [{ gap: 'g1', why_it_matters: 'm', how_to_practice: 'p', try_this_next_time: 't', resource: null }],
    priority_order: ['g1'],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.overrideMaxTokens, 8192);
});

test('runCoach normalizes a malformed model response to empty structures', async () => {
  const result = await runCoach({
    call: async () => ({ not_action_plan: true }),
    debriefOutput: '{}',
    candidateProfile: [],
    transcriptExcerpts: [],
    coachingBank: '',
  });
  assert.deepEqual(result, { action_plan: [], priority_order: [] });
});