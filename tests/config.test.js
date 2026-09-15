const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadStageOrder, parseTable, parseDecisions } = require('../server/config/stageOrder');

const FIXTURE = `
# Stage order

| Order | Stage | Mode | Min questions | Notes |
|---|---|---|---|---|
| 1 | greeting | none | 2 | tone |
| 2 | behavioral | dimension | 2 | |
| 3 | estimation | checklist | 1 | step-by-step |
| 4 | product_design | dimension | 2 | |
| 5 | case_study | dimension | 1 | back-and-forth |

## Decisions

- feedback_timing: stage_boundary
- clarify_cap_per_question: 3
`;

function writeFixture(content = FIXTURE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stageorder-'));
  const file = path.join(dir, 'stage_order.md');
  fs.writeFileSync(file, content);
  return file;
}

test('parses the stage table in order', () => {
  const config = loadStageOrder(writeFixture());
  assert.deepEqual(
    config.stages.map((s) => s.name),
    ['greeting', 'behavioral', 'estimation', 'product_design', 'case_study']
  );
  assert.equal(config.stages[1].minQuestions, 2);
  assert.equal(config.stages[2].mode, 'checklist');
  assert.equal(config.stages[4].mode, 'dimension');
});

test('parses decisions block', () => {
  const config = loadStageOrder(writeFixture());
  assert.equal(config.feedbackTiming, 'stage_boundary');
  assert.equal(config.timeBudgetMinutes, 60);
  assert.equal(config.clarifyCapPerQuestion, 3);
});

test('parses a custom time budget', () => {
  const config = loadStageOrder(writeFixture(FIXTURE + '\n- time_budget_minutes: 45\n'));
  assert.equal(config.timeBudgetMinutes, 45);
});

test('rejects an unknown feedback_timing value', () => {
  const bad = FIXTURE.replace('stage_boundary', 'every_ten_seconds');
  assert.throws(() => loadStageOrder(writeFixture(bad)), /Unknown feedback_timing/);
});

test('rejects a config with no parseable stages', () => {
  assert.throws(() => loadStageOrder(writeFixture('# no table here')), /No stages could be parsed/);
});

test('loads the real shipped config', () => {
  const config = loadStageOrder();
  assert.ok(config.stages.length >= 5);
  assert.ok(['stage_boundary', 'end_of_interview'].includes(config.feedbackTiming));
  assert.equal(config.clarifyCapPerQuestion, 3);
});

test('parseTable skips non-numeric rows and separator lines', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'server', 'config', 'stage_order.md'), 'utf8');
  const rows = parseTable(md);
  assert.ok(rows.every((r) => Number.isInteger(r.minQuestions)));
  assert.ok(rows.every((r) => ['none', 'checklist', 'dimension'].includes(r.mode)));
});

test('parseDecisions only records known keys', () => {
  const decisions = parseDecisions('## Decisions\n- feedback_timing: stage_boundary\n- something_else: 42\n');
  assert.deepEqual(decisions, { feedback_timing: 'stage_boundary' });
});