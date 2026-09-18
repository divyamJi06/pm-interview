const { loadPrompt } = require('./prompts');
const { fillTemplate } = require('./promptFiller');

function formatCandidateProfile(profile) {
  return Array.isArray(profile) && profile.length ? profile.join('\n') : '(none so far)';
}

function formatTranscriptExcerpts(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return '(no transcript excerpts available)';
  }
  const parts = [];
  for (const entry of entries) {
    const stage = entry.stage;
    const triples = entry.triples || [];
    if (!triples.length) continue;
    const block = triples
      .map((t) => {
        const label = t.isFollowUp ? 'Follow-up' : 'Question';
        const lines = [`${label}: ${t.question}`];
        if (t.clarifications && t.clarifications.length) {
          lines.push(`Candidate's clarifying questions before answering:`);
          for (const c of t.clarifications) {
            lines.push(`- asked: ${c.candidateQuestion}`);
            lines.push(`  interviewer answered: ${c.interviewerAnswer}`);
          }
        }
        lines.push(`Candidate's answer: ${t.answer}`);
        if (t.judge) lines.push(`How it was graded: ${JSON.stringify(t.judge)}`);
        return lines.join('\n');
      })
      .join('\n\n');
    parts.push(`--- STAGE: ${stage} ---\n${block}`);
  }
  return parts.length ? parts.join('\n\n') : '(no transcript excerpts available)';
}

function buildCoachPrompt({ debriefOutput, candidateProfile, transcriptExcerpts, coachingBank }) {
  return fillTemplate(loadPrompt('coach'), {
    verdict_and_gaps:
      typeof debriefOutput === 'string'
        ? debriefOutput
        : JSON.stringify(debriefOutput, null, 2),
    candidate_profile: formatCandidateProfile(candidateProfile),
    relevant_transcript_excerpts: formatTranscriptExcerpts(transcriptExcerpts),
    coaching_bank: coachingBank || '(no curated resource bank configured)',
  });
}

async function runCoach({ call, debriefOutput, candidateProfile, transcriptExcerpts, coachingBank }) {
  const prompt = buildCoachPrompt({ debriefOutput, candidateProfile, transcriptExcerpts, coachingBank });
  const parsed = await call(prompt, { overrideMaxTokens: 8192 });
  return {
    action_plan: Array.isArray(parsed.action_plan) ? parsed.action_plan : [],
    priority_order: Array.isArray(parsed.priority_order) ? parsed.priority_order : [],
  };
}

module.exports = { runCoach, buildCoachPrompt, formatCandidateProfile, formatTranscriptExcerpts };