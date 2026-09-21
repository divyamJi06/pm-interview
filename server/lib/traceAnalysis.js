const fs = require('fs');
const path = require('path');

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
}

function dirFor(rootDir, sessionId) {
  return path.join(rootDir, String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_'));
}

function splitLabel(label) {
  if (label === 'classify-turn') return { role: 'classify', stage: '' };
  const m = /^(judge|director-clarify|director|profile|synthesizer-stage|synthesizer-interview|coach|stt)(?:-(.+))?$/.exec(label || '');
  if (!m) return { role: 'model_call', stage: '' };
  return { role: m[1], stage: m[2] || '' };
}

function normalizeWs(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function sectionFrom(prompt, startMarker, stopMarkers) {
  const i = prompt.indexOf(startMarker);
  if (i < 0) return '';
  const from = i + startMarker.length;
  let end = prompt.length;
  for (const m of stopMarkers) {
    const idx = prompt.indexOf(m, from);
    if (idx >= 0 && idx < end) end = idx;
  }
  return prompt.slice(from, end).trim();
}

function summarizeSession(rootDir, sessionId) {
  const dir = dirFor(rootDir, sessionId);
  const info = readJsonSafe(path.join(dir, 'info.json'));
  if (!info) return null;
  const costs = readJsonSafe(path.join(dir, 'cost-summary.json')) || {};
  const callsDir = path.join(dir, 'calls');
  let verdict = null;
  let durationSec = null;
  if (fs.existsSync(callsDir)) {
    const synths = fs
      .readdirSync(callsDir)
      .filter((f) => f.includes('synthesizer') && f.endsWith('.json'))
      .sort()
      .map((f) => readJsonSafe(path.join(callsDir, f)))
      .filter(Boolean);
    const last = synths.at(-1);
    if (last) {
      const p = last.parsed || {};
      verdict = p.stage_verdict || p.overall_verdict || null;
    }
  }
  if (info.startedAt) {
    const start = new Date(info.startedAt).getTime();
    const end = costs.endedAt ? new Date(costs.endedAt).getTime() : Date.now();
    durationSec = Math.max(0, Math.round((end - start) / 1000));
  }
  return {
    sessionId,
    verdict,
    durationSec,
    outcome: costs.outcome || null,
    startedAt: info.startedAt,
    ...info,
    ...(costs.totals || {}),
  };
}

function listTraces(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => summarizeSession(rootDir, d.name))
    .filter(Boolean)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

function loadCalls(callsDir) {
  if (!fs.existsSync(callsDir)) return [];
  const calls = fs
    .readdirSync(callsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const c = readJsonSafe(path.join(callsDir, f));
      if (!c) return null;
      const { role, stage } = splitLabel(c.label || '');
      return {
        seq: c.seq,
        label: c.label,
        role,
        stage,
        success: c.success,
        error: c.error || null,
        prompt: c.prompt,
        outputText: c.outputText,
        parsed: c.parsed,
        usage: c.usage,
        costUsd: c.costUsd,
        durationMs: c.durationMs,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.seq - b.seq);
  return calls;
}

function buildTimeline(calls) {
  const events = [];
  const state = { currentQuestion: '' };

  function pushQuestion(stage, text) {
    const q = normalizeWs(text);
    if (!q || q === state.currentQuestion) return;
    state.currentQuestion = q;
    events.push({ type: 'question', stage, text: q });
  }

  for (const c of calls) {
    const p = c.parsed || {};
    if (c.role === 'classify') continue;

    if (c.role === 'director-clarify') {
      const question = sectionFrom(c.prompt, 'THE QUESTION THE CANDIDATE IS ANSWERING:', ["THE CANDIDATE'S CLARIFYING QUESTION:"]);
      const candidateQuestion = sectionFrom(c.prompt, "THE CANDIDATE'S CLARIFYING QUESTION:", ["WHAT'S KNOWN ABOUT THIS CANDIDATE"]);
      pushQuestion(c.stage, question);
      events.push({
        type: 'clarify',
        stage: c.stage,
        question: normalizeWs(question),
        candidateQuestion: normalizeWs(candidateQuestion),
        interviewerAnswer: normalizeWs(String(p.answer || '')),
        wrapUp: p.wrap_up === true,
      });
      continue;
    }

    if (c.role === 'judge') {
      const question = sectionFrom(c.prompt, 'QUESTION ASKED:', ['CLARIFYING EXCHANGE BEFORE THE ANSWER']);
      const answer = sectionFrom(c.prompt, "CANDIDATE'S ANSWER:", ['Weigh the clarifying exchange']);
      pushQuestion(c.stage, question);
      if (answer) events.push({ type: 'answer', stage: c.stage, text: answer });
      events.push({
        type: 'judge',
        stage: c.stage,
        verdict: p.overall_verdict || '',
        summary: normalizeWs(String(p.summary || '')),
        dimensions: p.dimension_scores || null,
        checklist: p.checklist_hits || null,
        green: p.green_flags_hit || [],
        red: p.red_flags_hit || [],
      });
      continue;
    }

    if (c.role === 'director') {
      events.push({
        type: 'director',
        stage: c.stage,
        decision: p.decision || '',
        followUpQuestion: normalizeWs(String(p.follow_up_question || '')),
        reasoning: normalizeWs(String(p.reasoning || '')),
      });
      continue;
    }

    if (c.role === 'profile') {
      const notes = Array.isArray(p.updated_profile) ? p.updated_profile : [];
      events.push({
        type: 'profile',
        stage: c.stage,
        text: (notes[notes.length - 1] || '').trim(),
      });
      continue;
    }

    if (c.role === 'synthesizer-stage') {
      events.push({
        type: 'stage_verdict',
        stage: c.stage,
        verdict: p.stage_verdict || '',
        summary: normalizeWs(String(p.summary || '')),
        strengths: p.strengths || [],
        gaps: p.gaps || [],
      });
      continue;
    }

    if (c.role === 'synthesizer-interview') {
      events.push({
        type: 'final_report',
        verdict: p.overall_verdict || '',
        summary: normalizeWs(String(p.summary || '')),
        crossStagePatterns: p.cross_stage_patterns || [],
        topThingsToWorkOn: p.top_things_to_work_on || [],
        recommendedResources: Array.isArray(p.recommended_resources) ? p.recommended_resources : [],
      });
      continue;
    }

    if (c.role === 'coach') {
      const plan = Array.isArray(p.action_plan) ? p.action_plan : [];
      events.push({
        type: 'coach',
        gapCount: plan.length,
        priority: Array.isArray(p.priority_order) ? p.priority_order : [],
        text: plan.length
          ? `Action plan for ${plan.length} gap${plan.length > 1 ? 's' : ''}: ${plan.map((g) => g.gap || '').join('; ')}`
          : 'Coach produced an empty action plan.',
      });
      continue;
    }

    events.push({ type: 'other', label: c.label, stage: c.stage, text: c.outputText || '' });
  }

  return events;
}

function timelineStats(timeline) {
  const stats = {
    answers: 0,
    totalAnswerChars: 0,
    clarifications: 0,
    followUpsAsked: 0,
    questions: 0,
    decisions: { follow_up: 0, next_question: 0, next_stage: 0, end_interview: 0 },
    verdicts: { strong: 0, developing: 0, weak: 0 },
  };
  for (const e of timeline) {
    if (e.type === 'answer') {
      stats.answers += 1;
      stats.totalAnswerChars += e.text.length;
    } else if (e.type === 'clarify') {
      stats.clarifications += 1;
    } else if (e.type === 'director') {
      stats.decisions[e.decision] = (stats.decisions[e.decision] || 0) + 1;
      if (e.decision === 'follow_up') stats.followUpsAsked += 1;
    } else if (e.type === 'judge') {
      if (e.verdict) stats.verdicts[e.verdict] = (stats.verdicts[e.verdict] || 0) + 1;
    } else if (e.type === 'question') {
      stats.questions += 1;
    }
  }
  stats.avgAnswerChars = stats.answers ? Math.round(stats.totalAnswerChars / stats.answers) : 0;
  return stats;
}

function readTrace(rootDir, sessionId) {
  const dir = dirFor(rootDir, sessionId);
  const info = readJsonSafe(path.join(dir, 'info.json'));
  if (!info) return null;
  const costs = readJsonSafe(path.join(dir, 'cost-summary.json')) || null;
  const calls = loadCalls(path.join(dir, 'calls'));
  const timeline = buildTimeline(calls);
  const stats = timelineStats(timeline);
  const verdict = summarizeSession(rootDir, sessionId).verdict;
  return { sessionId, info, costs, calls, timeline, stats, verdict };
}

module.exports = { listTraces, readTrace, buildTimeline, timelineStats, splitLabel, summarizeSession };