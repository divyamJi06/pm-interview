const crypto = require('crypto');

let sessions = new Map();
let persist = null;

function serializeSession(session) {
  return {
    ...session,
    questionsAsked: Object.fromEntries(session.questionsAsked),
    askedIndices: Object.fromEntries(
      [...session.askedIndices].map(([stage, set]) => [stage, [...set]])
    ),
    triples: Object.fromEntries(session.triples),
    synthRunStages: [...session.synthRunStages],
  };
}

function deserializeSession(data) {
  const session = { ...data };
  session.questionsAsked = new Map(Object.entries((data && data.questionsAsked) || {}));
  session.askedIndices = new Map(
    Object.entries((data && data.askedIndices) || {}).map(([stage, arr]) => [
      stage,
      new Set(Array.isArray(arr) ? arr : []),
    ])
  );
  session.triples = new Map(Object.entries((data && data.triples) || {}));
  session.synthRunStages = new Set(
    Array.isArray(data && data.synthRunStages) ? data.synthRunStages : []
  );
  return session;
}

function createSession({ trackId = 'pm', mode, practiceStage = null, targetRoleAndLevel = '', resume = '', candidateId = null, feedbackMode = 'full' } = {}) {
  const id = crypto.randomUUID();
  const session = {
    id,
    trackId,
    mode,
    practiceStage,
    candidateId,
    feedbackMode,
    targetRoleAndLevel,
    resume,
    stageIndex: 0,
    currentStageName: null,
    currentQuestion: null,
    awaiting: 'start',
    questionsAsked: new Map(),
    followUpsUsed: 0,
    followUpsThisQuestion: 0,
    askedIndices: new Map(),
    pendingClarifications: [],
    stageClarifications: 0,
    clarifyPhaseEnded: false,
    triples: new Map(),
    synthRunStages: new Set(),
    profile: [],
    stageVerdicts: [],
    finalReport: null,
    createdAt: Date.now(),
    endedAt: null,
  };
  sessions.set(id, session);
  if (persist) persist.save(serializeSession(session));
  return session;
}

function getSession(id) {
  return sessions.get(id) || null;
}

function removeSession(id) {
  sessions.delete(id);
  if (persist) persist.remove(id);
}

function clearSessions() {
  sessions = new Map();
}

function countSessions() {
  return sessions.size;
}

function list() {
  return [...sessions.values()];
}

function saveSession(id) {
  const session = sessions.get(id);
  if (persist && session) persist.save(serializeSession(session));
}

function setPersist(backend) {
  persist = backend || null;
}

function getPersist() {
  return persist;
}

function loadPersisted() {
  if (!persist) return 0;
  let loaded = 0;
  for (const data of persist.load()) {
    const session = deserializeSession(data);
    if (session.id && session.awaiting !== 'final_report') {
      sessions.set(session.id, session);
      loaded += 1;
    }
  }
  return loaded;
}

module.exports = {
  createSession,
  getSession,
  removeSession,
  clearSessions,
  countSessions,
  list,
  saveSession,
  setPersist,
  getPersist,
  loadPersisted,
  serializeSession,
  deserializeSession,
};