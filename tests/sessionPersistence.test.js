const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('../server/lib/sessionStore');
const { createSessionFileStore } = require('../server/lib/sessionFileStore');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('serialize/deserialize round-trips Maps and Sets', () => {
  const session = store.createSession({ mode: 'practice', practiceStage: 'estimation', resume: 'Led a fintech payments team of 8.' });
  session.questionsAsked.set('estimation', 2);
  session.askedIndices.set('estimation', new Set([0, 3]));
  session.triples.set('estimation', [{ question: 'Q', answer: 'A' }]);
  session.synthRunStages.add('estimation');
  session.currentQuestion = { text: 'How big?', isFollowUp: false };
  session.awaiting = 'answer';

  const restored = store.deserializeSession(store.serializeSession(session));
  assert.equal(restored.id, session.id);
  assert.equal(restored.mode, 'practice');
  assert.equal(restored.awaiting, 'answer');
  assert.equal(restored.resume, 'Led a fintech payments team of 8.');
  assert.equal(restored.questionsAsked.get('estimation'), 2);
  assert.deepEqual([...restored.askedIndices.get('estimation')], [0, 3]);
  assert.equal(restored.triples.get('estimation')[0].answer, 'A');
  assert.ok(restored.synthRunStages.has('estimation'));
  assert.equal(restored.currentQuestion.text, 'How big?');

  store.removeSession(session.id);
});

test('persistence backend receives saves, and loadPersisted restores sessions across a fake restart', () => {
  const snapshots = new Map();
  const backend = {
    save: (data) => snapshots.set(data.id, JSON.parse(JSON.stringify(data))),
    load: () => [...snapshots.values()],
    remove: (id) => snapshots.delete(id),
  };
  store.setPersist(backend);
  store.clearSessions();
  try {
    const s = store.createSession({ mode: 'mock' });
    s.questionsAsked.set('greeting', 1);
    s.askedIndices.set('greeting', new Set([0]));
    s.awaiting = 'answer';
    s.currentQuestion = { text: 'Tell me about yourself', isFollowUp: false };
    store.saveSession(s.id);
    assert.ok(snapshots.has(s.id), 'createSession saved a snapshot');

    store.clearSessions();
    assert.equal(store.getSession(s.id), null);
    const loaded = store.loadPersisted();
    assert.equal(loaded, 1);
    assert.equal(store.getSession(s.id).questionsAsked.get('greeting'), 1);
    assert.equal(store.getSession(s.id).awaiting, 'answer');
    assert.equal(store.getSession(s.id).currentQuestion.text, 'Tell me about yourself');

    store.removeSession(s.id);
    assert.ok(!snapshots.has(s.id), 'removeSession deletes the snapshot');
  } finally {
    store.setPersist(null);
    store.clearSessions();
  }
});

test('loadPersisted skips finished sessions', () => {
  const snapshots = new Map();
  const backend = {
    save: (data) => snapshots.set(data.id, JSON.parse(JSON.stringify(data))),
    load: () => [...snapshots.values()],
    remove: (id) => snapshots.delete(id),
  };
  store.setPersist(backend);
  store.clearSessions();
  try {
    const done = store.createSession({ mode: 'practice', practiceStage: 'behavioral' });
    done.awaiting = 'final_report';
    store.saveSession(done.id);
    const active = store.createSession({ mode: 'practice', practiceStage: 'estimation' });
    active.awaiting = 'answer';
    store.saveSession(active.id);

    store.clearSessions();
    assert.equal(store.loadPersisted(), 1);
    assert.equal(store.getSession(done.id), null);
    assert.equal(store.getSession(active.id).awaiting, 'answer');
  } finally {
    store.setPersist(null);
    store.clearSessions();
  }
});

test('sessionFileStore writes, loads and removes snapshots to disk', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-files-'));
  try {
    const store_ = createSessionFileStore({ rootDir: root });
    store_.save({ id: 'abc-123', awaiting: 'answer', anything: true });
    store_.save({ id: 'def-456', awaiting: 'answer' });
    const loaded = store_.load();
    assert.equal(loaded.length, 2);
    assert.equal(loaded.find((s) => s.id === 'abc-123').anything, true);

    store_.remove('abc-123');
    assert.deepEqual(store_.load().map((s) => s.id), ['def-456']);
    store_.remove('def-456');
    assert.deepEqual(store_.load(), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});