const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

const { createServer } = require('../server/server');
const { listTracks, getTrack, resetRegistry } = require('../server/config/tracks');
const { loadStage } = require('../server/lib/loadStage');

const PM_STAGES = [
  'greeting',
  'behavioral',
  'estimation',
  'product_design',
  'case_study',
  'strategy',
  'execution_metrics',
  'technical',
];
const DEV_STAGES = [
  'greeting',
  'behavioral',
  'algorithms',
  'system_design',
  'debugging',
  'distributed_systems',
];

async function boot() {
  const mock = { callModel() { throw new Error('no model calls expected'); } };
  const server = createServer({ callModel: mock.callModel, rng: () => 0 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function get(base, path) {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
}

test('track registry exposes pm and dev tracks with distinct tokens', () => {
  resetRegistry();
  const all = listTracks();
  const ids = all.map((t) => t.id);
  assert.ok(ids.includes('pm'));
  assert.ok(ids.includes('dev'));

  const pm = getTrack('pm');
  assert.equal(pm.tokens.role, 'PM');
  assert.equal(pm.tokens.role_lower, 'product manager');
  assert.equal(pm.config.stages.length, 8);

  const dev = getTrack('dev');
  assert.equal(dev.tokens.role, 'software engineering');
  assert.equal(dev.tokens.role_lower, 'software engineer');
  assert.deepEqual(dev.config.stages.map((s) => s.name), DEV_STAGES);

  assert.equal(getTrack(undefined).id, 'pm');
  assert.equal(getTrack('bogus').id, 'pm');
});

test('GET /api/tracks lists available tracks', async (t) => {
  const { server, base } = await boot();
  t.after(() => server.close());

  const res = await get(base, '/api/tracks');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const dev = res.body.tracks.find((x) => x.id === 'dev');
  assert.equal(dev.label, 'Software Engineering');
});

test('GET /api/stages honors the track query and defaults to pm', async (t) => {
  const { server, base } = await boot();
  t.after(() => server.close());

  const devRes = await get(base, '/api/stages?track=dev');
  assert.equal(devRes.status, 200);
  assert.equal(devRes.body.track, 'dev');
  assert.deepEqual(devRes.body.stages.map((s) => s.name), DEV_STAGES);
  assert.equal(devRes.body.feedbackTiming, 'stage_boundary');

  const pmRes = await get(base, '/api/stages');
  assert.equal(pmRes.body.track, 'pm');
  assert.deepEqual(pmRes.body.stages.map((s) => s.name), PM_STAGES);
});

test('unknown track falls back to the default pm ordering', async (t) => {
  const { server, base } = await boot();
  t.after(() => server.close());

  const res = await get(base, '/api/stages?track=does_not_exist');
  assert.equal(res.status, 200);
  assert.equal(res.body.track, 'pm');
});

test('dev track stages load questions and rubrics with config mode', () => {
  resetRegistry();
  const dev = getTrack('dev');
  const modes = new Map(dev.config.stages.map((s) => [s.name, s.mode]));
  for (const stage of ['algorithms', 'system_design', 'debugging', 'distributed_systems', 'behavioral']) {
    const s = loadStage(stage, { dataDir: dev.stagesDir, mode: modes.get(stage) });
    assert.ok(s.questions.length >= 2, `${stage} questions`);
    assert.equal(s.mode, 'dimension', `${stage} mode`);
    assert.ok(s.rubric.intent, `${stage} rubric intent`);
  }
});