const crypto = require('crypto');

let candidates = new Map();
let persist = null;

function createCandidate({ targetRoleAndLevel = '', resume = '', profile = [] } = {}) {
  const id = crypto.randomUUID();
  const candidate = {
    id,
    targetRoleAndLevel,
    resume,
    profile: Array.isArray(profile) ? profile.slice() : [],
    stageVerdicts: [],
    coveredStages: [],
    roundHistory: [],
    debriefReport: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  candidates.set(id, candidate);
  if (persist) persist.save(candidate);
  return candidate;
}

function getCandidate(id) {
  return candidates.get(id) || null;
}

function list() {
  return [...candidates.values()];
}

function removeCandidate(id) {
  candidates.delete(id);
  if (persist) persist.remove(id);
}

function clearCandidates() {
  candidates = new Map();
}

function countCandidates() {
  return candidates.size;
}

function saveCandidate(id) {
  const candidate = candidates.get(id);
  if (persist && candidate) persist.save(candidate);
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
    if (data && data.id) {
      candidates.set(data.id, data);
      loaded += 1;
    }
  }
  return loaded;
}

module.exports = {
  createCandidate,
  getCandidate,
  removeCandidate,
  clearCandidates,
  countCandidates,
  list,
  saveCandidate,
  setPersist,
  getPersist,
  loadPersisted,
};