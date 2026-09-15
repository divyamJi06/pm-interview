const test = require('node:test');
const assert = require('node:assert/strict');

const { parseQuestions, parseRubricSections, modeForStage, loadStage } = require('../server/lib/loadStage');

test('parseQuestions extracts numbered list items', () => {
  const qs = parseQuestions('1. First question.\n\n2. Second question\nNot a question\n3. Third');
  assert.deepEqual(qs, ['First question.', 'Second question', 'Third']);
});

test('loadStage parses questions and rubric for a real stage', () => {
  const stage = loadStage('estimation');
  assert.equal(stage.name, 'estimation');
  assert.ok(stage.questions.length >= 1);
  assert.equal(stage.mode, 'checklist');
  assert.ok(stage.rubric.intent.length > 0);
  assert.ok(stage.rubric.redFlags.length > 0);
});

test('loadStage derives dimension mode for behavioral', () => {
  const stage = loadStage('behavioral');
  assert.equal(stage.mode, 'dimension');
  assert.ok(stage.rubric.scoringDimensions.includes('Ownership & agency'));
});

test('greeting has no rubric and is ungraded', () => {
  const stage = loadStage('greeting');
  assert.equal(stage.mode, 'none');
  assert.equal(stage.rubric, null);
});

test('case_study rubric stops at the trailing note heading', () => {
  const stage = loadStage('case_study');
  assert.ok(stage.rubric.redFlags.includes('mechanical'));
  assert.ok(!stage.rubric.redFlags.includes('PMs focus'));
});

test('parseRubricSections extracts clean section bodies', () => {
  const md = [
    '## Intent',
    'Probe depth.',
    '',
    '## Ideal structure',
    '1. Context',
    '2. Result',
    '',
    '## Green flags',
    '- first-person ownership',
    '- quantified outcome',
  ].join('\n');
  const rubric = parseRubricSections(md);
  assert.equal(rubric.intent, 'Probe depth.');
  assert.equal(rubric.idealStructure, '1. Context\n2. Result');
  assert.equal(rubric.greenFlags, 'first-person ownership\nquantified outcome');
  assert.equal(rubric.scoringDimensions, '');
});

test('unknown stage names resolve to none mode', () => {
  assert.equal(modeForStage('something_else'), 'none');
  assert.equal(modeForStage('ESTIMATION'), 'checklist');
});

test('strategy stage loads a full rubric with book-based content', () => {
  const stage = loadStage('strategy');
  assert.equal(stage.mode, 'dimension');
  assert.ok(stage.rubric.intent.includes('business judgment'));
  assert.ok(stage.rubric.idealStructure.includes('micro'));
  assert.ok(stage.rubric.scoringDimensions.includes('Framework judgment'));
  assert.ok(stage.rubric.greenFlags.includes('macro'));
  assert.ok(stage.rubric.redFlags.includes('force-fits'));
});

test('execution_metrics stage loads a full rubric with metric families', () => {
  const stage = loadStage('execution_metrics');
  assert.equal(stage.mode, 'dimension');
  assert.ok(stage.rubric.scoringDimensions.includes('Metric selection'));
  assert.ok(stage.rubric.idealStructure.includes('conversion & retention'));
  assert.ok(stage.rubric.greenFlags.includes('cohorts'));
  assert.ok(stage.rubric.redFlags.includes('vanity'));
});

test('technical stage loads a full rubric about trade-offs and clarity', () => {
  const stage = loadStage('technical');
  assert.equal(stage.mode, 'dimension');
  assert.ok(stage.rubric.intent.includes('trade-offs'));
  assert.ok(stage.rubric.idealStructure.includes('Clarify the problem'));
  assert.ok(stage.rubric.greenFlags.includes('clarifying questions'));
  assert.ok(stage.rubric.redFlags.includes('hand-waves'));
});