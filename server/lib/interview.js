const { loadPrompt } = require('./prompts');
const { fillTemplate } = require('./promptFiller');
const { loadStage } = require('./loadStage');
const { loadResourceBank, formatResourceBank } = require('./resourceBank');
const { userError } = require('./userError');
const { DEFAULT_TOKENS } = require('../config/tracks');
const coach = require('./coach');

const MAX_TURNS_PER_STAGE = 10;
const MIN_CLARIFY_BEFORE_WRAP = 1;
const IDLE_GRACE_MS = 5 * 60 * 1000;

function markActivity(session) {
  const now = Date.now();
  if (session.lastActivityAt) {
    const gap = now - session.lastActivityAt;
    if (gap > IDLE_GRACE_MS) {
      session.idleMs = (session.idleMs || 0) + gap - IDLE_GRACE_MS;
    }
  }
  session.lastActivityAt = now;
}

function makeDeps({
  callModel,
  config,
  loadStageFn = loadStage,
  promptReader = loadPrompt,
  templateFiller = fillTemplate,
  rng = Math.random,
  traceStore,
  resourceBankReader = loadResourceBank,
  resourceBankFormatter = formatResourceBank,
  trackTokens = DEFAULT_TOKENS,
}) {
  const tf = templateFiller === fillTemplate
    ? (template, data) => fillTemplate(template, { ...trackTokens, ...data })
    : templateFiller;
  return { callModel, config, loadStage: loadStageFn, promptReader, templateFiller: tf, rng, traceStore, resourceBankReader, resourceBankFormatter, trackTokens };
}

function callTraced({ deps, session, label, prompt, opts = {} }) {
  if (!deps.traceStore) return deps.callModel(prompt, opts);
  const onCall = (record) => deps.traceStore.recordCall({ sessionId: session.id, record });
  return deps.callModel(prompt, { ...opts, label, onCall });
}

function stagesFor(session, config) {
  if (session.mode === 'practice') {
    return [config.stages.find((s) => s.name === session.practiceStage) || config.stages[0]];
  }
  return config.stages;
}

function isLastStage(session, deps) {
  const stages = stagesFor(session, deps.config);
  return session.stageIndex >= stages.length - 1;
}

function formatProfile(profile) {
  return Array.isArray(profile) && profile.length ? profile.join('\n') : '(none so far)';
}

function formatResume(resume) {
  return typeof resume === 'string' && resume.trim() ? resume.trim() : '(none provided)';
}

function formatClarifications(list) {
  if (!list || !list.length) return '(none)';
  return list
    .map((c) => `Candidate asked: ${c.candidateQuestion}\nInterviewer replied: ${c.interviewerAnswer}`)
    .join('\n\n');
}

function formatTriples(triples) {
  return triples
    .map((t) => {
      const label = t.isFollowUp ? `Follow-up` : `Question`;
      const parts = [`${label} asked: ${t.question}`];
      if (t.clarifications && t.clarifications.length) {
        parts.push(
          `Candidate's clarifying questions before answering:\n${t.clarifications
            .map((c) => `- asked: ${c.candidateQuestion}\n  interviewer answered: ${c.interviewerAnswer}`)
            .join('\n')}`
        );
      }
      parts.push(`Candidate's answer: ${t.answer}`);
      parts.push(`How it was graded: ${t.judge ? JSON.stringify(t.judge) : '(ungraded)'}`);
      return parts.join('\n');
    })
    .join('\n\n');
}

function stageProgress(session, stage, deps) {
  const cfg = deps.config.stages.find((s) => s.name === stage.name) || {};
  return {
    questionsAsked: session.questionsAsked.get(stage.name) || 0,
    minQuestions: cfg.minQuestions,
    followUpsUsed: session.followUpsUsed,
    followUpsThisQuestion: session.followUpsThisQuestion,
    clarifyingQuestionsThisStage: session.stageClarifications,
  };
}

function pacingFor(session, config) {
  const budget =
    session.mode === 'practice'
      ? config.roundBudgetMinutes || 40
      : config.timeBudgetMinutes || 60;
  const activeMs = Math.max(0, (Date.now() - session.createdAt) - (session.idleMs || 0));
  const elapsed = activeMs / 60000;
  const ratio = elapsed / budget;
  const label =
    ratio > 0.8
      ? 'TIME IS TIGHT - be lean and prioritize finishing'
      : ratio > 0.5
        ? 'about half the time budget is used - keep a steady pace'
        : 'plenty of time left - going deep where it matters is fine';
  return {
    elapsedMinutes: Math.round(elapsed),
    budget,
    remaining: Math.max(0, Math.round(budget - elapsed)),
    label,
  };
}

function summarizeJudge(stage, judge) {
  if (!judge) return '(no judge output yet)';
  if (stage.mode === 'checklist' && judge.checklist_hits) {
    const entries = Object.entries(judge.checklist_hits);
    if (entries.length === 0) return '(checklist scored but empty)';
    const hits = entries.filter(([, v]) => v).length;
    const state =
      hits === entries.length
        ? 'intent captured'
        : hits === 0
          ? 'intent not captured yet'
          : 'partially captured';
    return `checklist: ${hits}/${entries.length} steps hit (${state})`;
  }
  if (judge.dimension_scores) {
    const entries = Object.entries(judge.dimension_scores);
    if (entries.length === 0) return '(dimensions scored but empty)';
    const avg = entries.reduce((a, [, v]) => a + v, 0) / entries.length;
    const worst = entries.sort((a, b) => a[1] - b[1])[0];
    return `dimensions: avg ${avg.toFixed(1)}/5, weakest ${worst[0]} (${worst[1]}/5), verdict ${judge.overall_verdict || 'n/a'}`;
  }
  return '(no scoring available)';
}

function lastJudge(session, stage) {
  return (session.triples.get(stage.name) || [])
    .filter((t) => t.judge)
    .at(-1)?.judge || null;
}

function loadQuestionAt(session, stage, index, deps) {
  session.currentStageName = stage.name;
  session.currentQuestion = { text: stage.questions[index], isFollowUp: false };
  session.pendingClarifications = [];
  session.stageClarifications = 0;
  session.followUpsThisQuestion = 0;
  session.clarifyPhaseEnded = false;
  let asked = session.askedIndices.get(stage.name);
  if (!asked) {
    asked = new Set();
    session.askedIndices.set(stage.name, asked);
  }
  asked.add(index);
  session.questionsAsked.set(stage.name, (session.questionsAsked.get(stage.name) || 0) + 1);
  session.followUpsUsed = 0;
}

function pickUnaskedQuestion(stage, session, deps) {
  const asked = session.askedIndices.get(stage.name) || new Set();
  const candidates = stage.questions
    .map((q, i) => ({ q, i }))
    .filter(({ i }) => !asked.has(i));
  const pool = candidates.length > 0 ? candidates : stage.questions.map((q, i) => ({ q, i }));
  return pool[Math.floor(deps.rng() * pool.length)];
}

async function runJudge({ session, stage, question, answer, deps }) {
  const promptName = stage.mode === 'checklist' ? 'judge_checklist' : 'judge_dimension';
  const filled = deps.templateFiller(deps.promptReader(promptName), {
    intent: stage.rubric.intent,
    idealStructure: stage.rubric.idealStructure,
    scoringDimensions: stage.rubric.scoringDimensions,
    greenFlags: stage.rubric.greenFlags,
    redFlags: stage.rubric.redFlags,
    question,
    answer,
    candidate_profile: formatProfile(session.profile),
    candidate_clarifications: formatClarifications(session.pendingClarifications),
    candidate_resume: formatResume(session.resume),
  });
  const result = await callTraced({ deps, session, label: `judge-${stage.name}`, prompt: filled, opts: { overrideMaxTokens: 4096 } });
  const { updated_profile, ...judge } = result && typeof result === 'object' ? result : {};
  if (Array.isArray(updated_profile)) {
    session.profile = updated_profile.slice(-12);
  }
  return judge;
}

async function runStageSynthesizer({ session, stage, deps }) {
  const triples = session.triples.get(stage.name) || [];
  const filled = deps.templateFiller(deps.promptReader('synthesizer_stage'), {
    stage_name: stage.name,
    stage_intent: stage.rubric.intent,
    qa_pairs_with_feedback: formatTriples(triples),
  });
  return callTraced({ deps, session, label: `synthesizer-stage-${stage.name}`, prompt: filled, opts: { overrideMaxTokens: 8192 } });
}

async function synthesizeCurrentStageIfNeeded({ session, deps }) {
  const stage = deps.loadStage(session.currentStageName);
  if (session.synthRunStages.has(stage.name)) return;
  if (stage.mode === 'none' || !stage.rubric) return;
  const verdict = await runStageSynthesizer({ session, stage, deps });
  session.stageVerdicts.push({ stage: stage.name, verdict });
  session.synthRunStages.add(stage.name);
}

async function runInterviewSynthesizer({ session, deps }) {
  const filled = deps.templateFiller(deps.promptReader('synthesizer_interview'), {
    ...deps.trackTokens,
    candidate_target_role_and_level: session.targetRoleAndLevel || `(general ${deps.trackTokens.role_lower} role)`,
    all_stage_verdicts: JSON.stringify(session.stageVerdicts, null, 2),
    final_candidate_profile: formatProfile(session.profile),
    resource_bank: deps.resourceBankFormatter(deps.resourceBankReader()),
  });
  return callTraced({ deps, session, label: 'synthesizer-interview', prompt: filled, opts: { overrideMaxTokens: 8192 } });
}

async function runDebrief({ candidate, deps }) {
  const sessionLike = {
    id: `debrief-${candidate.id || 'candidate'}`,
    targetRoleAndLevel: candidate.targetRoleAndLevel || '',
    profile: candidate.profile || [],
    stageVerdicts: candidate.stageVerdicts || [],
  };
  const filled = deps.templateFiller(deps.promptReader('synthesizer_interview'), {
    ...deps.trackTokens,
    candidate_target_role_and_level: sessionLike.targetRoleAndLevel || `(general ${deps.trackTokens.role_lower} role)`,
    all_stage_verdicts: JSON.stringify(sessionLike.stageVerdicts, null, 2),
    final_candidate_profile: formatProfile(sessionLike.profile),
    resource_bank: deps.resourceBankFormatter(deps.resourceBankReader()),
  });
  return callTraced({ deps, session: sessionLike, label: 'synthesizer-interview', prompt: filled, opts: { overrideMaxTokens: 8192 } });
}

function buildBase(session, stage, deps, extra = {}) {
  return {
    ok: true,
    sessionId: session.id,
    mode: session.mode,
    stage: { name: stage.name, index: session.stageIndex, total: stagesFor(session, deps.config).length },
    stageProgress: stageProgress(session, stage, deps),
    ...extra,
  };
}

function resume(session, deps) {
  markActivity(session);
  const stage = deps.loadStage(session.currentStageName);
  return buildBase(session, stage, deps, {
    state: session.awaiting === 'final_report' ? 'final_report' : 'question',
    question: session.currentQuestion,
    transcript: transcriptFromSession(session),
  });
}

function transcriptFromSession(session) {
  const hidePerAnswerJudge = session.mode === 'mock' || session.feedbackMode === 'simulation';
  const transcript = [];
  for (const [stage, triples] of session.triples) {
    for (const t of triples) {
      transcript.push({ type: 'question', stage, text: t.question, isFollowUp: !!t.isFollowUp });
      for (const c of t.clarifications || []) {
        transcript.push({
          type: 'clarify',
          stage,
          candidateQuestion: c.candidateQuestion,
          interviewerAnswer: c.interviewerAnswer,
          wrapUp: false,
        });
      }
      transcript.push({ type: 'answer', stage, text: t.answer });
      if (t.judge && !hidePerAnswerJudge) {
        transcript.push({
          type: 'judge',
          stage,
          verdict: t.judge.overall_verdict || '',
          summary: String(t.judge.summary || ''),
          dimension_scores: t.judge.dimension_scores || null,
          checklist_hits: t.judge.checklist_hits || null,
          green_flags_hit: t.judge.green_flags_hit || [],
          red_flags_hit: t.judge.red_flags_hit || [],
        });
      }
    }
  }
  for (const sv of session.stageVerdicts || []) {
    transcript.push({ type: 'stage_verdict', stage: sv.stage, verdict: sv.verdict });
  }
  return transcript;
}

function begin(session, deps) {
  const stages = stagesFor(session, deps.config);
  const first = stages[0];
  session.stageIndex = 0;
  const stage = deps.loadStage(first.name);
  session.triples.set(stage.name, []);
  const picked = pickUnaskedQuestion(stage, session, deps);
  loadQuestionAt(session, stage, picked.i, deps);
  markActivity(session);
  session.awaiting = 'answer';
  if (deps.traceStore) {
    deps.traceStore.initSession({
      sessionId: session.id,
      mode: session.mode,
      practiceStage: session.practiceStage,
      targetRoleAndLevel: session.targetRoleAndLevel,
      config: deps.config,
    });
  }
  return buildBase(session, stage, deps, {
    state: 'question',
    question: session.currentQuestion,
  });
}

async function provideFeedback(session, deps, latestJudge) {
  if (session.mode !== 'practice') return null;
  if (session.feedbackMode === 'simulation') return null;
  return latestJudge;
}

function transcriptEntriesFromSession(session) {
  return [...(session.triples || new Map())].map(([stage, triples]) => ({ stage, triples }));
}

async function runCoachTraced({ session, deps, debriefOutput, candidateProfile, transcriptExcerpts }) {
  const coachingBank = deps.resourceBankFormatter(deps.resourceBankReader());
  return coach.runCoach({
    call: (prompt, opts) => callTraced({ deps, session, label: 'coach', prompt, opts }),
    debriefOutput,
    candidateProfile,
    transcriptExcerpts,
    coachingBank,
    tokens: deps.trackTokens,
  });
}

async function finishMockInterview({ session, deps }) {
  await synthesizeCurrentStageIfNeeded({ session, deps });
  const report = await runInterviewSynthesizer({ session, deps });
  let coachResult = { action_plan: [], priority_order: [] };
  try {
    coachResult = await runCoachTraced({
      session,
      deps,
      debriefOutput: report,
      candidateProfile: session.profile,
      transcriptExcerpts: transcriptEntriesFromSession(session),
    });
  } catch (err) {
    console.warn(`Coach failed for session ${session.id}: ${err.message}`);
  }
  session.coachReport = coachResult;
  session.finalReport = report;
  session.awaiting = 'final_report';
  session.endedAt = Date.now();
  if (deps.traceStore) deps.traceStore.finalizeSession({ sessionId: session.id, outcome: 'finished' });
  const stage = deps.loadStage(session.currentStageName);
  return buildBase(session, stage, deps, {
    state: 'final_report',
    report: {
      report,
      stageVerdicts: session.stageVerdicts,
      action_plan: coachResult.action_plan,
      priority_order: coachResult.priority_order,
    },
  });
}

async function finishPracticeSession({ session, deps }) {
  await synthesizeCurrentStageIfNeeded({ session, deps });
  const stage = deps.loadStage(session.currentStageName);
  const lastJudge = (session.triples.get(stage.name) || [])
    .filter((t) => t.judge)
    .at(-1)?.judge || null;
  let roundCoach = { action_plan: [], priority_order: [] };
  const verdict = (session.stageVerdicts || []).at(-1)?.verdict;
  if (verdict) {
    try {
      roundCoach = await runCoachTraced({
        session,
        deps,
        debriefOutput: verdict,
        candidateProfile: session.profile,
        transcriptExcerpts: transcriptEntriesFromSession(session),
      });
    } catch (err) {
      console.warn(`Coach failed for round ${session.id}: ${err.message}`);
    }
  }
  session.coachReport = roundCoach;
  session.awaiting = 'final_report';
  session.endedAt = Date.now();
  if (deps.traceStore) deps.traceStore.finalizeSession({ sessionId: session.id, outcome: 'finished' });
  return buildBase(session, stage, deps, {
    state: 'final_report',
    feedback: session.feedbackMode === 'simulation' ? null : lastJudge,
    report: {
      mode: 'practice',
      stageVerdicts: session.stageVerdicts,
      action_plan: roundCoach.action_plan,
      priority_order: roundCoach.priority_order,
    },
  });
}

async function moveToNextStage({ session, deps }) {
  const prevName = session.currentStageName;
  await synthesizeCurrentStageIfNeeded({ session, deps });
  const prevVerdict = session.stageVerdicts.find((v) => v.stage === prevName)?.verdict || null;

  if (isLastStage(session, deps)) {
    return session.mode === 'mock'
      ? finishMockInterview({ session, deps })
      : finishPracticeSession({ session, deps });
  }

  session.stageIndex += 1;
  const stages = stagesFor(session, deps.config);
  const next = deps.loadStage(stages[session.stageIndex].name);
  session.triples.set(next.name, []);
  const picked = pickUnaskedQuestion(next, session, deps);
  loadQuestionAt(session, next, picked.i, deps);
  session.awaiting = 'answer';

  const reveal = session.mode === 'practice' || deps.config.feedbackTiming === 'stage_boundary';
  return buildBase(session, next, deps, {
    state: 'transition',
    transition: { from: prevName, to: next.name, stageVerdict: reveal ? prevVerdict : null },
    question: session.currentQuestion,
  });
}

async function runSimpleDirector({ session, deps }) {
  const stage = deps.loadStage(session.currentStageName);
  const cfg = deps.config.stages.find((s) => s.name === stage.name) || {};
  const asked = session.questionsAsked.get(stage.name) || 0;
  if (asked < cfg.minQuestions) {
    const picked = pickUnaskedQuestion(stage, session, deps);
    session.currentQuestion = { text: picked.q, isFollowUp: false };
    session.askedIndices.get(stage.name).add(picked.i);
    session.questionsAsked.set(stage.name, asked + 1);
    session.followUpsThisQuestion = 0;
    session.clarifyPhaseEnded = false;
    return { decision: 'next_question' };
  }
  return { decision: 'next_stage' };
}

async function runAiDirector({ session, stage, judge, deps }) {
  const cfg = deps.config.stages.find((s) => s.name === stage.name) || {};
  const asked = session.questionsAsked.get(stage.name) || 0;
  const pacing = pacingFor(session, deps.config);
  const filled = deps.templateFiller(deps.promptReader('director'), {
    stage_name: stage.name,
    stage_intent: stage.rubric.intent,
    questions_asked_this_stage: asked,
    min_questions_this_stage: cfg.minQuestions,
    questions_remaining_this_stage: Math.max(0, cfg.minQuestions - asked),
    follow_ups_asked_this_question: session.followUpsThisQuestion,
    follow_ups_asked_this_stage: session.followUpsUsed,
    clarifying_questions_this_stage: String(session.stageClarifications || 0),
    dialogue_turns_this_stage: (session.triples.get(stage.name) || []).length,
    time_elapsed_minutes: pacing.elapsedMinutes,
    time_budget_minutes: pacing.budget,
    time_remaining_minutes: pacing.remaining,
    pacing_gauge: pacing.label,
    intent_coverage: summarizeJudge(stage, judge),
    last_answer_was_follow_up: session.currentQuestion?.isFollowUp ? 'true' : 'false',
    last_judge_output: JSON.stringify(judge, null, 2),
    candidate_profile: formatProfile(session.profile),
    is_last_stage: isLastStage(session, deps) ? 'true' : 'false',
  });
  const result = await callTraced({ deps, session, label: `director-${stage.name}`, prompt: filled, opts: { thinkTokens: 512 } });
  return {
    decision: result.decision,
    followUpQuestion: result.follow_up_question || null,
    reasoning: result.reasoning || '',
  };
}

async function handleNextQuestion({ session, stage, deps }) {
  const askedSet = session.askedIndices.get(stage.name) || new Set();
  const candidates = stage.questions
    .map((q, i) => ({ q, i }))
    .filter(({ i }) => !askedSet.has(i));
  if (candidates.length === 0) {
    return moveToNextStage({ session, deps });
  }
  const picked = candidates[Math.floor(deps.rng() * candidates.length)];
  session.currentQuestion = { text: picked.q, isFollowUp: false };
  session.askedIndices.get(stage.name).add(picked.i);
  session.questionsAsked.set(stage.name, (session.questionsAsked.get(stage.name) || 0) + 1);
  session.followUpsThisQuestion = 0;
  session.clarifyPhaseEnded = false;
  return { state: 'question' };
}

async function processAnswer({ session, answerText, deps }) {
  markActivity(session);
  const stage = deps.loadStage(session.currentStageName);
  const current = session.currentQuestion;
  const triples = session.triples.get(stage.name) || [];

  let judge;
  let feedback = null;

  if (stage.mode !== 'none' && stage.rubric) {
    judge = await runJudge({ session, stage, question: current.text, answer: answerText, deps });
  }

  triples.push({
    question: current.text,
    answer: answerText,
    isFollowUp: !!current.isFollowUp,
    clarifications: session.pendingClarifications.slice(),
    judge,
    answeredAt: Date.now(),
  });
  session.pendingClarifications = [];
  session.clarifyPhaseEnded = false;

  feedback = await provideFeedback(session, deps, judge);

  let decision;
  if (stage.mode === 'none' || !stage.rubric) {
    decision = await runSimpleDirector({ session, deps });
  } else {
    const dir = await runAiDirector({ session, stage, judge, deps });
    if (dir.decision === 'follow_up') {
      if (!dir.followUpQuestion) {
        decision = { decision: 'next_question' };
      } else {
        session.followUpsUsed += 1;
        session.followUpsThisQuestion += 1;
        session.currentQuestion = { text: dir.followUpQuestion, isFollowUp: true };
        decision = { decision: 'follow_up' };
      }
    } else {
      decision = dir;
    }
  }

  const pacing = pacingFor(session, deps.config);
  const turnsThisStage = (session.triples.get(stage.name) || []).length;
  const guardFired =
    turnsThisStage >= MAX_TURNS_PER_STAGE || pacing.elapsedMinutes >= pacing.budget;
  if (guardFired) {
    decision = { decision: isLastStage(session, deps) ? 'end_interview' : 'next_stage' };
  } else if (
    decision.decision === 'next_stage' ||
    decision.decision === 'end_interview'
  ) {
    const cfgFloor = deps.config.stages.find((s) => s.name === stage.name) || {};
    const askedMain = session.questionsAsked.get(stage.name) || 0;
    const askedSet = session.askedIndices.get(stage.name) || new Set();
    const bankHasUnasked = stage.questions.some((_, i) => !askedSet.has(i));
    if (askedMain < (cfgFloor.minQuestions || 0) && bankHasUnasked) {
      decision = { decision: 'next_question' };
    }
  }

  if (decision.decision === 'next_question') {
    return handleNextQuestion({ session, stage, deps }).then((res) =>
      session.mode === 'practice' && res.state === 'question'
        ? buildBase(session, deps.loadStage(session.currentStageName), deps, {
            ...res,
            question: session.currentQuestion,
            feedback,
          })
        : res.state === 'question'
          ? buildBase(session, stage, deps, { ...res, question: session.currentQuestion, feedback: null })
          : res
    );
  }

  if (decision.decision === 'follow_up') {
    return buildBase(session, stage, deps, {
      state: 'follow_up',
      question: session.currentQuestion,
      feedback,
      directorReasoning: decision.reasoning,
    });
  }

  if (decision.decision === 'end_interview') {
    return session.mode === 'mock'
      ? finishMockInterview({ session, deps })
      : finishPracticeSession({ session, deps });
  }

  return moveToNextStage({ session, deps });
}

async function processClarify({ session, clarifyText, deps }) {
  markActivity(session);
  const stage = deps.loadStage(session.currentStageName);
  if (session.awaiting !== 'answer') {
    throw userError('This session is not waiting for an answer, so there is nothing to clarify.', 409);
  }
  if (stage.mode === 'none' || !stage.rubric) {
    throw userError(`Clarifying questions aren't available in the ${stage.name} stage.`, 400);
  }
  if (session.clarifyPhaseEnded) {
    throw userError('The interviewer has asked you to answer now - go ahead and answer the question.', 409);
  }
  const clarifyCap = deps.config.clarifyCapPerQuestion || 3;
  if ((session.pendingClarifications.length || 0) >= clarifyCap) {
    throw userError('The interviewer has asked you to answer now - you have asked enough clarifying questions on this question.', 409);
  }
  const pacing = pacingFor(session, deps.config);
  if (pacing.elapsedMinutes >= pacing.budget) {
    throw userError('Time is up for this stage of the interview - go ahead and answer the question.', 409);
  }
  const cfg = deps.config.stages.find((s) => s.name === stage.name) || {};
  const questionsRemaining = Math.max(0, (cfg.minQuestions || 0) - (session.questionsAsked.get(stage.name) || 0));
  const filled = deps.templateFiller(deps.promptReader('director_clarify'), {
    stage_name: stage.name,
    stage_intent: stage.rubric.intent,
    ideal_structure: stage.rubric.idealStructure,
    green_flags: stage.rubric.greenFlags,
    red_flags: stage.rubric.redFlags,
    question: session.currentQuestion.text,
    clarify_question: clarifyText,
    candidate_profile: formatProfile(session.profile),
    clarifying_questions_asked_this_question: session.pendingClarifications.length,
    clarifying_questions_asked_this_stage: session.stageClarifications,
    clarify_cap: clarifyCap,
    follow_ups_asked_this_question: session.followUpsThisQuestion,
    dialogue_turns_this_stage: (session.triples.get(stage.name) || []).length,
    questions_remaining_this_stage: questionsRemaining,
    intent_coverage: summarizeJudge(stage, lastJudge(session, stage)),
    time_elapsed_minutes: pacing.elapsedMinutes,
    time_budget_minutes: pacing.budget,
    time_remaining_minutes: pacing.remaining,
    pacing_gauge: pacing.label,
  });
  const result = await callTraced({ deps, session, label: `director-clarify-${stage.name}`, prompt: filled, opts: { thinkTokens: 0 } });
  const interviewerAnswer = result.answer || '(no answer given)';
  const wrapUp = result.wrap_up === true && session.pendingClarifications.length >= MIN_CLARIFY_BEFORE_WRAP;
  session.pendingClarifications.push({
    question: session.currentQuestion.text,
    candidateQuestion: clarifyText,
    interviewerAnswer,
    askedAt: Date.now(),
  });
  session.stageClarifications += 1;
  if (wrapUp) session.clarifyPhaseEnded = true;
  return buildBase(session, stage, deps, {
    state: 'clarify_reply',
    clarifyAnswer: interviewerAnswer,
    question: session.currentQuestion,
    wrapUp,
  });
}

async function classifyTurn({ deps, session, text }) {
  const trimmed = String(text).trim();
  if (trimmed.length > 160 && !trimmed.includes('?')) return 'answer';
  if (trimmed.length <= 24) {
    return trimmed.includes('?') ? 'clarify' : 'answer';
  }
  const filled = deps.templateFiller(deps.promptReader('classify_turn'), {
    question: session.currentQuestion ? session.currentQuestion.text : '(no question yet)',
    message: trimmed,
  });
  try {
    const result = await callTraced({ deps, session, label: 'classify-turn', prompt: filled, opts: { thinkTokens: 0 } });
    return result.type === 'clarify' ? 'clarify' : 'answer';
  } catch {
    return trimmed.includes('?') ? 'clarify' : 'answer';
  }
}

module.exports = {
  makeDeps,
  begin,
  resume,
  transcriptFromSession,
  processAnswer,
  processClarify,
  classifyTurn,
  runDebrief,
  runCoachTraced,
  stagesFor,
  isLastStage,
  formatProfile,
  formatTriples,
};