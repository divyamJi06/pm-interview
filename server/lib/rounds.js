const candidateStore = require('./candidateStore');

function gradedStages(config) {
  return (config.stages || []).filter((s) => s.mode !== 'none');
}

function coverage(candidate, config) {
  const total = gradedStages(config);
  const totalNames = total.map((s) => s.name);
  const covered = (candidate.coveredStages || []).filter((s) => totalNames.includes(s));
  const missing = totalNames.filter((n) => !covered.includes(n));
  return { covered, total: total.length, done: covered.length === total.length, missing };
}

function mergeSessionIntoCandidate(candidate, session) {
  if (Array.isArray(session.profile) && session.profile.length) {
    candidate.profile = session.profile.slice(-12);
  }
  const verdicts = Array.isArray(session.stageVerdicts) ? session.stageVerdicts : [];
  for (const sv of verdicts) {
    if (!sv || !sv.stage) continue;
    candidate.stageVerdicts = candidate.stageVerdicts.filter((v) => v.stage !== sv.stage);
    candidate.stageVerdicts.push(sv);
    if (!candidate.coveredStages.includes(sv.stage)) {
      candidate.coveredStages.push(sv.stage);
    }
    candidate.roundHistory.push({
      stage: sv.stage,
      sessionId: session.id,
      verdict: sv.verdict,
      startedAt: session.createdAt,
      endedAt: Date.now(),
    });
    const triples = session.triples && session.triples.get ? session.triples.get(sv.stage) || [] : [];
    candidate.qaHistory = (candidate.qaHistory || []).filter((q) => q.stage !== sv.stage);
    candidate.qaHistory.push({ stage: sv.stage, triples });
  }
  candidate.updatedAt = Date.now();
}

function candidatePayload(candidate, config) {
  if (!candidate) return null;
  const cov = coverage(candidate, config);
  return {
    id: candidate.id,
    trackId: candidate.trackId || 'pm',
    targetRoleAndLevel: candidate.targetRoleAndLevel,
    coveredStages: cov.covered,
    total: cov.total,
    done: cov.done,
    missing: cov.missing,
    roundsPlayed: (candidate.roundHistory || []).length,
    hasDebrief: !!candidate.debriefReport,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

function candidateDetailPayload(candidate, config) {
  const base = candidatePayload(candidate, config);
  return {
    ...base,
    profile: candidate.profile || [],
    stageVerdicts: candidate.stageVerdicts || [],
    roundHistory: candidate.roundHistory || [],
    debriefReport: candidate.debriefReport || null,
  };
}

module.exports = { gradedStages, coverage, mergeSessionIntoCandidate, candidatePayload, candidateDetailPayload };