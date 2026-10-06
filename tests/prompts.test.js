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

test('fillTemplate matches keys case-insensitively ignoring brackets and underscores', () => {
  const out = fillTemplate('{{ideal_structure}}/{{scoring_dimensions}}', { idealStructure: 'shape', scoring_dimensions: 'dims' });
  assert.equal(out, 'shape/dims');
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

test('judge prompts expose a candidate_resume slot and the updated_profile output', () => {
  for (const name of ['judge_dimension', 'judge_checklist']) {
    const body = loadPrompt(name);
    assert.ok(body.includes('{{candidate_resume}}'), name);
    assert.ok(body.includes('updated_profile'), name);
    assert.ok(body.includes('not a restatement of the verdict or score'), name);
    const filled = fillTemplate(body, {
      intent: 'i', idealStructure: 's', scoringDimensions: 'dims', greenFlags: 'g', redFlags: 'r',
      question: 'q', answer: 'a', candidate_profile: '[]', candidate_clarifications: '(none)',
      candidate_resume: 'Led payments at a fintech.',
    });
    assert.ok(filled.includes('Led payments at a fintech.'), name);
    assert.ok(!/\{\{/.test(filled), `${name} filled prompt must not leak placeholders`);
  }
});

test('director prompt includes the real-interview follow-up playbooks', () => {
  const body = loadPrompt('director');
  assert.ok(body.includes('Constraint injection'));
  assert.ok(body.includes('Story drilling'));
  assert.ok(body.includes('what did you personally do vs. the team?'));
  assert.ok(body.includes('flag "we"-heavy answers this way'));
});

// Without the question and answer in context the Director invents a follow-up
// on an unrelated topic, and the next grading pass then scores the candidate
// against a question they were never asked.
test('director prompt is given the question and answer its follow-up must stay on', () => {
  const body = loadPrompt('director');
  assert.ok(body.includes('{{last_question}}'));
  assert.ok(body.includes('{{last_answer}}'));
  assert.ok(body.includes('Never introduce a different product, company, or'));
  const filled = fillTemplate(body, {
    stage_name: 'estimation',
    stage_intent: 'approach matters',
    questions_asked_this_stage: '1',
    min_questions_this_stage: '1',
    questions_remaining_this_stage: '0',
    follow_ups_asked_this_question: '0',
    follow_ups_asked_this_stage: '0',
    clarifying_questions_this_stage: '0',
    dialogue_turns_this_stage: '1',
    time_elapsed_minutes: '2',
    time_budget_minutes: '45',
    time_remaining_minutes: '43',
    pacing_gauge: 'relaxed',
    intent_coverage: 'checklist: 3/8 steps hit',
    last_question: 'Estimate WhatsApp users in Hyderabad.',
    last_answer: 'Top-down from 10M metro population.',
    last_judge_output: '{}',
    last_answer_was_follow_up: 'false',
    candidate_profile: '[]',
    is_last_stage: 'false',
    role: 'Product Management',
    company_examples: 'tech',
    senior_title: 'senior',
  });
  assert.ok(filled.includes('Estimate WhatsApp users in Hyderabad.'));
  assert.ok(filled.includes('Top-down from 10M metro population.'));
  assert.ok(!/\{\{/.test(filled), 'filled director prompt must not leak placeholders');
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