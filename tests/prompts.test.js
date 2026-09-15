const test = require('node:test');
const assert = require('node:assert/strict');

const { fillTemplate } = require('../server/lib/promptFiller');
const { loadPrompt, extractPromptBody } = require('../server/lib/prompts');
const { parseJsonResponse } = require('../server/lib/callModel');

test('fillTemplate replaces every placeholder', () => {
  const out = fillTemplate('A {{x}} with {{y}} and {{x}} again', { x: '1', y: 'two' });
  assert.equal(out, 'A 1 with two and 1 again');
});

test('fillTemplate renders arrays as lines', () => {
  const out = fillTemplate('list:\n{{items}}', { items: ['a', 'b'] });
  assert.equal(out, 'list:\na\nb');
});

test('fillTemplate substitutes missing values with (empty) instead of leaking syntax', () => {
  const out = fillTemplate('x={{missing}}', {});
  assert.equal(out, 'x=(empty)');
});

test('loadPrompt extracts only the fenced prompt body', () => {
  const body = loadPrompt('judge_dimension');
  assert.ok(body.includes('You are grading a candidate'));
  assert.ok(!body.includes('## Prompt body'));
  assert.ok(!body.includes('## Notes'));
  assert.ok(body.includes('"strong" | "developing" | "weak"'));
});

test('every role prompt template parses and fills without leftover placeholders', () => {
  const names = ['classify_turn', 'judge_checklist', 'judge_dimension', 'director', 'director_clarify', 'profile_writer', 'synthesizer_stage', 'synthesizer_interview'];
  for (const name of names) {
    const body = loadPrompt(name);
    assert.ok(body.length > 100, name);
    const filled = fillTemplate(body, { anything: 'hello' });
    assert.ok(!/\{\{/.test(filled), `${name} leaked a placeholder`);
  }
});

test('parseJsonResponse strips markdown fences', () => {
  const out = parseJsonResponse('```json\n{"a": 1}\n```');
  assert.deepEqual(out, { a: 1 });
});

test('parseJsonResponse extracts JSON embedded in prose', () => {
  const out = parseJsonResponse('Sure thing!\n\n{"decision": "next_stage", "reasoning": "done"}\n\nHope that helps.');
  assert.deepEqual(out, { decision: 'next_stage', reasoning: 'done' });
});

test('parseJsonResponse throws on non-JSON output', () => {
  assert.throws(() => parseJsonResponse('no json here at all'), /no JSON object/);
});

test('synthesizer_interview exposes a resource_bank slot and the recommended_resources output shape', () => {
  const body = loadPrompt('synthesizer_interview');
  assert.ok(body.includes('{{resource_bank}}'));
  assert.ok(body.includes('RESOURCE BANK:'));
  assert.ok(body.includes('recommended_resources'));
  assert.ok(body.includes('never invent new titles'));
  const filled = fillTemplate(body, {
    candidate_target_role_and_level: 'x',
    all_stage_verdicts: 'y',
    final_candidate_profile: 'z',
    resource_bank: 'STATISTICS: Thinking in Bets',
  });
  assert.ok(!/\{\{/.test(filled), 'filled prompt must not leak placeholders');
  assert.ok(filled.includes('STATISTICS: Thinking in Bets'));
});

test('profile_writer exposes a candidate_resume slot that fills cleanly', () => {
  const body = loadPrompt('profile_writer');
  assert.ok(body.includes('{{candidate_resume}}'));
  assert.ok(body.includes('fold the most relevant ones into the running profile'));
  const filled = fillTemplate(body, {
    question: 'q',
    answer: 'a',
    judge_output: '{}',
    existing_profile: '[]',
    candidate_resume: 'Led payments at a fintech.',
  });
  assert.ok(filled.includes('Led payments at a fintech.'));
  assert.ok(!/\{\{/.test(filled), 'filled prompt must not leak placeholders');
});

test('director prompt includes the real-interview follow-up playbooks', () => {
  const body = loadPrompt('director');
  assert.ok(body.includes('Constraint injection'));
  assert.ok(body.includes('Story drilling'));
  assert.ok(body.includes('what did you personally do vs. the team?'));
  assert.ok(body.includes('flag "we"-heavy answers this way'));
});

test('director prompt includes restrained real-interviewer demeanor guidance', () => {
  const body = loadPrompt('director');
  assert.ok(body.includes('Real-interviewer demeanor'));
  assert.ok(body.includes('Do not reassure'));
  assert.ok(body.includes('never hostile'));
  assert.ok(body.includes('do not manufacture tension for its own sake'));
});

test('extractPromptBody returns empty string when no body section exists', () => {
  assert.equal(extractPromptBody('# only a title'), '');
});