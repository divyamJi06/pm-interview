const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('../server/lib/sessionStore');

test('createSession returns a session with defaults', () => {
  const s = store.createSession({ mode: 'mock' });
  assert.ok(s.id);
  assert.equal(s.mode, 'mock');
  assert.deepEqual([...s.askedIndices.keys()], []);
  assert.deepEqual(s.profile, []);
  assert.equal(s.awaiting, 'start');
  assert.equal(s.resume, '');
  store.removeSession(s.id);
});

test('createSession stores an optional resume for profile context', () => {
  const s = store.createSession({ mode: 'practice', practiceStage: 'behavioral', resume: 'Led a 6-person fintech team.' });
  assert.equal(s.resume, 'Led a 6-person fintech team.');
  store.removeSession(s.id);
});

test('getSession/removeSession round-trip', () => {
  const s = store.createSession({ mode: 'practice', practiceStage: 'behavioral' });
  assert.equal(store.getSession(s.id), s);
  assert.equal(store.getSession(s.id).practiceStage, 'behavioral');
  store.removeSession(s.id);
  assert.equal(store.getSession(s.id), null);
});

test('missing session returns null', () => {
  assert.equal(store.getSession('nope'), null);
});

test('clearSessions empties the store', () => {
  store.createSession({ mode: 'mock' });
  store.createSession({ mode: 'practice', practiceStage: 'estimation' });
  assert.ok(store.countSessions() >= 2);
  store.clearSessions();
  assert.equal(store.countSessions(), 0);
});