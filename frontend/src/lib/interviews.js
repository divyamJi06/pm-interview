import { supabase, supabaseConfigured, requireSupabase } from './supabase';

// Every read and write of the candidate's interview history. The dashboard, the
// stage breakdown and the session detail page all go through here so the table
// names and the shape of an interview row are written down exactly once.
//
// Row level security means a candidate can only ever see their own rows; there
// is no user_id filter here on purpose. Adding one would be belt and braces,
// but it would also let a bug in a filter silently show an empty history instead
// of an error.

export const STAGES = [
  {
    id: 'estimation',
    label: 'Estimation',
    blurb: 'Fermi questions. Size the answer, show the reasoning, land in the right order of magnitude.',
  },
  {
    id: 'product_design',
    label: 'Product design',
    blurb: 'Turn a vague request into a product: clarify, constrain, prioritise, and defend the trade-offs.',
  },
  {
    id: 'case_study',
    label: 'Case study',
    blurb: 'Structure an ambiguous business problem and drive it to a recommendation.',
  },
  {
    id: 'strategy',
    label: 'Strategy',
    blurb: 'Market entry, competitive response, and the platform versus portfolio argument.',
  },
  {
    id: 'execution_metrics',
    label: 'Technical execution',
    blurb: 'Shipping a roadmap: dependencies, sequencing, metrics, and what to cut when it slips.',
  },
  {
    id: 'technical',
    label: 'Technical depth',
    blurb: 'How the product is actually built — architecture, data, and the limits of the system.',
  },
  {
    id: 'behavioral',
    label: 'Behavioural',
    blurb: 'Story questions, conflict, failure, and influence without someone to influence.',
  },
];

export const STAGE_LABEL = STAGES.reduce((acc, s) => ({ ...acc, [s.id]: s.label }), {});

export function stageLabel(stage) {
  // Empty means no stage, not a "full mock": the multi-stage round no longer
  // exists, so callers render their own placeholder instead of a stale name.
  if (!stage) return '';
  if (STAGE_LABEL[stage]) return STAGE_LABEL[stage];
  return String(stage).replace(/_/g, ' ');
}

export async function listInterviews() {
  if (!supabaseConfigured) return [];
  const { data, error } = await supabase
    .from('interviews')
    .select(
      'id, session_id, mode, stage, status, feedback_mode, voice_mode, target_role, question_count, answer_count, overall_score, stage_scores, strongest_dimension, weakest_dimension, started_at, ended_at'
    )
    .order('started_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

// The interview is created the moment the engine accepts /api/start, so an
// abandoned run still shows up in the history with status "live" instead of
// vanishing. The unique index on (user_id, session_id) makes a retry safe.
export async function createInterviewRow({ sessionId, stage, voiceMode, targetRole }) {
  const sb = requireSupabase();
  const { data: auth } = await sb.auth.getUser();
  const user = auth && auth.user;
  if (!user) throw new Error('Not signed in.');
  const { data, error } = await sb
    .from('interviews')
    .upsert(
      {
        user_id: user.id,
        session_id: sessionId,
        // Every round is a single-stage mock, so both of these are fixed rather
        // than chosen per run.
        mode: 'mock',
        stage,
        feedback_mode: 'full',
        voice_mode: Boolean(voiceMode),
        target_role: targetRole || '',
        status: 'live',
      },
      { onConflict: 'user_id,session_id' }
    )
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function finishInterviewRow(interviewId, patch) {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase
    .from('interviews')
    .update({ ...patch, status: patch.status || 'completed' })
    .eq('id', interviewId)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// Rejoining an interview that is already in the history. The engine's session id
// is the join key, so a resumed round writes its report to the same row instead
// of starting a second entry.
// The transcript as rows. The engine sends the whole transcript on every reply,
// so this upserts the lot against (interview_id, seq): entries already stored are
// updated, new ones appended, and re-sending the same reply changes nothing.
// That is what makes it safe to call after every single answer without tracking
// what has already been sent.
const TURN_KINDS = new Set(['question', 'answer', 'clarify', 'judge', 'stage_verdict']);

// The engine's transcript entry -> a row. Anything it sends that is not one of
// the five known kinds is dropped rather than guessed at, because the seq it
// would take has to stay aligned with what is already stored.
export function turnRowsFromTranscript(transcript) {
  const rows = [];
  if (!Array.isArray(transcript)) return rows;
  transcript.forEach((e, seq) => {
    if (!e || !TURN_KINDS.has(e.type)) return;
    const detail = {};
    if (e.type === 'clarify') {
      detail.candidate_question = e.candidateQuestion || '';
      detail.interviewer_answer = e.interviewerAnswer || '';
      detail.wrap_up = Boolean(e.wrapUp);
    } else if (e.type === 'judge') {
      detail.verdict = e.verdict || '';
      detail.summary = e.summary || '';
      detail.dimension_scores = e.dimension_scores || null;
      detail.checklist_hits = e.checklist_hits || null;
      detail.green_flags_hit = e.green_flags_hit || [];
      detail.red_flags_hit = e.red_flags_hit || [];
    } else if (e.type === 'stage_verdict') {
      detail.verdict = e.verdict || null;
    }
    rows.push({
      seq,
      kind: e.type,
      stage: e.stage || null,
      is_follow_up: Boolean(e.isFollowUp),
      text: String(e.text == null ? '' : e.text),
      detail,
    });
  });
  return rows;
}

export async function saveTranscript(interviewId, transcript) {
  if (!supabaseConfigured || !interviewId) return 0;
  const rows = turnRowsFromTranscript(transcript);
  if (!rows.length) return 0;
  const sb = requireSupabase();
  const { data: auth } = await sb.auth.getUser();
  const user = auth && auth.user;
  if (!user) throw new Error('Not signed in.');
  const { error } = await sb
    .from('interview_turns')
    .upsert(
      rows.map((r) => ({ ...r, interview_id: interviewId, user_id: user.id })),
      { onConflict: 'interview_id,seq' }
    );
  if (error) throw new Error(error.message);
  return rows.length;
}

export async function listTurns(interviewId) {
  if (!supabaseConfigured || !interviewId) return [];
  const { data, error } = await supabase
    .from('interview_turns')
    .select('seq, kind, stage, is_follow_up, text, detail')
    .eq('interview_id', interviewId)
    .order('seq', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

// Where a live round stopped. Written alongside the transcript so "Resume this
// round" can reopen the exact question the candidate was last asked, with the
// transcript already on screen, without depending on the engine still holding
// the session in memory.
export async function saveLiveState(interviewId, state) {
  if (!supabaseConfigured || !interviewId) return null;
  const sb = requireSupabase();
  const { data: auth } = await sb.auth.getUser();
  const user = auth && auth.user;
  if (!user) throw new Error('Not signed in.');
  const { data, error } = await sb
    .from('interview_live_state')
    .upsert(
      {
        interview_id: interviewId,
        user_id: user.id,
        session_id: state.sessionId || '',
        stage: state.stage || null,
        stage_index: Number(state.stageIndex) || 0,
        pending_question: state.pendingQuestion || '',
        pending_follow_up: Boolean(state.pendingFollowUp),
        stage_progress: state.stageProgress || {},
        turns_written: Number(state.turnsWritten) || 0,
      },
      { onConflict: 'interview_id' }
    )
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getLiveState(interviewId) {
  if (!supabaseConfigured || !interviewId) return null;
  const { data, error } = await supabase
    .from('interview_live_state')
    .select('session_id, stage, stage_index, pending_question, pending_follow_up, stage_progress, turns_written')
    .eq('interview_id', interviewId)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

export async function clearLiveState(interviewId) {
  if (!supabaseConfigured || !interviewId) return;
  const { error } = await supabase.from('interview_live_state').delete().eq('interview_id', interviewId);
  if (error) throw new Error(error.message);
}

export async function findInterviewBySession(sessionId) {
  if (!supabaseConfigured || !sessionId) return null;
  const { data, error } = await supabase
    .from('interviews')
    .select('id, status, stage')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

export async function saveReport(interviewId, report) {
  if (!supabaseConfigured) return null;
  const sb = requireSupabase();
  const { data: auth } = await sb.auth.getUser();
  const user = auth && auth.user;
  if (!user) throw new Error('Not signed in.');
  const { error } = await sb
    .from('interview_reports')
    .upsert({ interview_id: interviewId, user_id: user.id, report }, { onConflict: 'interview_id' });
  if (error) throw new Error(error.message);
}

export async function getReport(interviewId) {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase
    .from('interview_reports')
    .select('report, created_at')
    .eq('interview_id', interviewId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// The engine's final payload carries a `scores` block: { overall, byDimension,
// answersScored } on a 0-100 scale, aggregated by the server. That block is the
// only numeric source, because per-answer judges are hidden from the transcript
// in mock and simulation mode and the stage synthesiser emits verdict words
// rather than numbers.
//
// Older sessions persisted before this block existed are not in Supabase, so
// there is no back-compat path to keep here.
export function scoreFromReport(payload) {
  const scores = (payload && payload.scores) || null;
  const byDimension = (scores && scores.byDimension) || {};
  const ranked = Object.entries(byDimension).sort((a, b) => b[1] - a[1]);
  return {
    overall: scores && Number.isFinite(Number(scores.overall)) ? Number(scores.overall) : null,
    dimensions: byDimension,
    strongest: ranked.length ? ranked[0][0] : null,
    weakest: ranked.length ? ranked[ranked.length - 1][0] : null,
    answersScored: (scores && scores.answersScored) || 0,
  };
}

export function countsFromReport(payload) {
  const counts = (payload && payload.counts) || {};
  return {
    questions: counts.questions || 0,
    answers: counts.answers || 0,
    clarifications: counts.clarifications || 0,
    stages: counts.stages || 0,
  };
}

// The dashboard's analytics. Deliberately computed in the browser from the
// candidate's own rows: the row count is small (tens, not thousands), and a
// Postgres view would be one more thing to keep in sync with the column list
// above for no measurable gain.
export function summarise(interviews) {
  const done = interviews.filter((i) => i.status === 'completed');
  const byStage = STAGES.map((stage) => {
    const rows = done.filter((i) => i.stage === stage.id);
    const scores = rows.map((i) => Number(i.overall_score)).filter((n) => Number.isFinite(n));
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const trend =
      scores.length >= 2 ? scores[0] - scores[scores.length - 1] : null;
    return {
      ...stage,
      count: rows.length,
      average: avg,
      latest: scores.length ? scores[0] : null,
      trend,
      lastAt: rows.length ? rows[0].started_at : null,
    };
  });

  const allScores = done.map((i) => Number(i.overall_score)).filter((n) => Number.isFinite(n));
  const overall = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : null;

  const dimensionTotals = {};
  for (const row of done) {
    const scores = row.stage_scores || {};
    for (const [dim, value] of Object.entries(scores)) {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      if (!dimensionTotals[dim]) dimensionTotals[dim] = { sum: 0, count: 0 };
      dimensionTotals[dim].sum += n;
      dimensionTotals[dim].count += 1;
    }
  }
  const dimensions = Object.entries(dimensionTotals)
    .map(([name, { sum, count }]) => ({ name, average: sum / count, count }))
    .sort((a, b) => b.average - a.average);

  return {
    total: interviews.length,
    completed: done.length,
    live: interviews.filter((i) => i.status === 'live').length,
    overall,
    lastAt: interviews.length ? interviews[0].started_at : null,
    byStage,
    strongest: dimensions[0] || null,
    weakest: dimensions.length ? dimensions[dimensions.length - 1] : null,
    dimensions,
  };
}
