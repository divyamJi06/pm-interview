const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const candidateStore = require('../server/lib/candidateStore');
const { createCandidateFileStore } = require('../server/lib/candidateFileStore');
const rounds = require('../server/lib/rounds');
const { loadStageOrder } = require('../server/config/stageOrder');

const config = loadStageOrder();

test('createCandidate builds a fresh candidate and is retrievable', () => {
  candidateStore.clearCandidates();
  const c = candidateStore.createCandidate({ targetRoleAndLevel: 'Senior PM', resume: 'Led payments' });
  assert.ok(c.id);
  assert.equal(candidateStore.getCandidate(c.id), c);
  assert.equal(candidateStore.countCandidates(), 1);
  assert.deepEqual(c.stageVerdicts, []);
  assert.deepEqual(c.coveredStages, []);
  assert.equal(c.debriefReport, null);
  candidateStore.clearCandidates();
});

test('coverage reports all seven graded stages and excludes the greeting', () => {
  candidateStore.clearCandidates();
  const c = candidateStore.createCandidate({});
  const cov = rounds.coverage(c, config);
  assert.equal(cov.total, 7);
  assert.equal(cov.done, false);
  assert.ok(cov.missing.includes('behavioral'));
  assert.ok(!cov.missing.includes('greeting'));
  assert.equal(cov.missing.length, 7);

  c.coveredStages = ['behavioral', 'estimation', 'product_design', 'case_study', 'strategy', 'execution_metrics', 'technical'];
  const done = rounds.coverage(c, config);
  assert.equal(done.done, true);
  assert.deepEqual(done.missing, []);
  candidateStore.clearCandidates();
});

test('mergeSessionIntoCandidate folds profile, verdict, coverage, round history, and Q/A history', () => {
  candidateStore.clearCandidates();
  const c = candidateStore.createCandidate({});
  const session = {
    id: 'round-1',
    createdAt: 1000,
    profile: ['notes a', 'notes b'],
    stageVerdicts: [{ stage: 'behavioral', verdict: { stage_verdict: 'strong', summary: 'ok' } }],
    triples: new Map([['behavioral', [{ question: 'Q1', answer: 'A1', isFollowUp: false, clarifications: [], judge: { overall_verdict: 'strong' } }]]]),
  };
  rounds.mergeSessionIntoCandidate(c, session);
  assert.deepEqual(c.profile, ['notes a', 'notes b']);
  assert.deepEqual(c.coveredStages, ['behavioral']);
  assert.equal(c.stageVerdicts.length, 1);
  assert.equal(c.roundHistory.length, 1);
  assert.equal(c.roundHistory[0].stage, 'behavioral');
  assert.equal(c.roundHistory[0].sessionId, 'round-1');
  assert.equal(c.qaHistory.length, 1);
  assert.equal(c.qaHistory[0].stage, 'behavioral');
  assert.equal(c.qaHistory[0].triples[0].answer, 'A1');

  const second = {
    id: 'round-2',
    createdAt: 2000,
    profile: ['notes a', 'notes b', 'notes c'],
    stageVerdicts: [{ stage: 'behavioral', verdict: { stage_verdict: 'weak', summary: 'regressed' } }],
    triples: new Map([['behavioral', [{ question: 'Q1', answer: 'A2', isFollowUp: false, clarifications: [], judge: { overall_verdict: 'weak' } }]]]),
  };
  rounds.mergeSessionIntoCandidate(c, second);
  assert.equal(c.profile.length, 3);
  assert.equal(c.stageVerdicts.length, 1, 'repeated stage keeps only the latest verdict');
  assert.equal(c.stageVerdicts[0].verdict.stage_verdict, 'weak');
  assert.deepEqual(c.coveredStages, ['behavioral'], 'already-covered stages are not duplicated');
  assert.equal(c.roundHistory.length, 2);
  assert.equal(c.qaHistory.length, 1, 'repeated stage keeps only the latest Q/A history');
  assert.equal(c.qaHistory[0].triples[0].answer, 'A2');
  candidateStore.clearCandidates();
});

test('mergeSessionIntoCandidate tolerates sessions without a triples map', () => {
  candidateStore.clearCandidates();
  const c = candidateStore.createCandidate({});
  rounds.mergeSessionIntoCandidate(c, {
    id: 'r',
    createdAt: 0,
    profile: ['x'],
    stageVerdicts: [{ stage: 'behavioral', verdict: { stage_verdict: 'developing', summary: '' } }],
  });
  assert.equal(c.qaHistory.length, 1);
  assert.deepEqual(c.qaHistory[0].triples, []);
  candidateStore.clearCandidates();
});

test('profile is capped to the latest 12 notes on merge', () => {
  candidateStore.clearCandidates();
  const c = candidateStore.createCandidate({});
  const profile = Array.from({ length: 15 }, (_, i) => `note ${i + 1}`);
  rounds.mergeSessionIntoCandidate(c, { id: 'r', createdAt: 0, profile, stageVerdicts: [] });
  assert.equal(c.profile.length, 12);
  assert.equal(c.profile[0], 'note 4');
  assert.equal(c.profile[11], 'note 15');
  candidateStore.clearCandidates();
});

test('candidatePayload exposes coverage and hasDebrief', () => {
  candidateStore.clearCandidates();
  const c = candidateStore.createCandidate({ targetRoleAndLevel: 'APM' });
  const payload = rounds.candidatePayload(c, config);
  assert.equal(payload.id, c.id);
  assert.equal(payload.total, 7);
  assert.equal(payload.done, false);
  assert.equal(payload.hasDebrief, false);
  c.debriefReport = { report: {}, at: 1 };
  assert.equal(rounds.candidatePayload(c, config).hasDebrief, true);
  candidateStore.clearCandidates();
});

test('candidateFileStore persists candidates and survives a reload', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-files-'));
  const backend = createCandidateFileStore({ rootDir: root });

  candidateStore.setPersist(backend);
  candidateStore.clearCandidates();
  try {
    const c = candidateStore.createCandidate({ targetRoleAndLevel: 'Senior PM', resume: 'SaaS PM' });
    c.coveredStages = ['behavioral'];
    candidateStore.saveCandidate(c.id);

    candidateStore.clearCandidates();
    assert.equal(candidateStore.getCandidate(c.id), null);
    assert.equal(candidateStore.loadPersisted(), 1);
    const restored = candidateStore.getCandidate(c.id);
    assert.equal(restored.targetRoleAndLevel, 'Senior PM');
    assert.deepEqual(restored.coveredStages, ['behavioral']);

    candidateStore.removeCandidate(c.id);
    assert.deepEqual(storeLoad(backend), 0);
  } finally {
    candidateStore.setPersist(null);
    candidateStore.clearCandidates();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function storeLoad(backend) {
  return backend.load().length;
}