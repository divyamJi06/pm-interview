const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseResourceBank,
  loadResourceBank,
  formatResourceBank,
  COACHING_DIR,
} = require('../server/lib/resourceBank');

test('parseResourceBank turns dimension headings and bullets into sections', () => {
  const md = [
    '# Statistical & probabilistic reasoning',
    '- Thinking in Bets — Annie Duke — judgment under uncertainty',
    '',
    '# Business modeling',
    '- Crossing the Chasm — Geoffrey A. Moore',
    '',
    'not a heading, not a bullet',
  ].join('\n');
  const out = parseResourceBank(md);
  assert.equal(out.length, 2);
  assert.equal(out[0].dimension, 'Statistical & probabilistic reasoning');
  assert.deepEqual(out[0].resources, ['Thinking in Bets — Annie Duke — judgment under uncertainty']);
  assert.equal(out[1].dimension, 'Business modeling');
  assert.equal(out[1].resources.length, 1);
});

test('the shipped resource bank loads with dimensions and real entries', () => {
  const bank = loadResourceBank({ dataDir: COACHING_DIR });
  assert.ok(bank.length >= 5, `expected several dimensions, got ${bank.length}`);
  for (const section of bank) {
    assert.ok(section.dimension.trim().length > 0);
    assert.ok(section.resources.length > 0, section.dimension);
    for (const r of section.resources) {
      assert.ok(r.trim().length > 2, `empty resource entry under ${section.dimension}`);
      assert.ok(/[A-Za-z]/.test(r), `resource entry looks empty: ${r}`);
    }
  }
  const titles = bank.flatMap((s) => s.resources);
  assert.equal(new Set(titles).size, titles.length, 'resource bank must not duplicate entries');
});

test('formatResourceBank renders dimension-labeled bullets and no placeholders', () => {
  const out = formatResourceBank([{ dimension: 'd1', resources: ['r1 — x', 'r2 — y'] }]);
  assert.match(out, /d1:/);
  assert.match(out, /r1 — x/);
  assert.ok(!out.includes('{{'));
});

test('formatResourceBank handles an empty or missing bank', () => {
  assert.equal(formatResourceBank([]), '(no curated resource bank configured)');
  assert.equal(formatResourceBank(null), '(no curated resource bank configured)');
});
