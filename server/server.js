const http = require('http');
const fs = require('fs');
const path = require('path');

const { loadEnvIntoProcess } = require('./lib/loadEnv');
loadEnvIntoProcess();

const { loadStageOrder } = require('./config/stageOrder');
const { createCallModel, DEFAULT_PROVIDER } = require('./lib/callModel');
const { createTranscriber } = require('./lib/transcribe');
const { createTraceStore } = require('./lib/traceStore');
const { createSessionFileStore } = require('./lib/sessionFileStore');
const { createCandidateFileStore } = require('./lib/candidateFileStore');
const { isUserError } = require('./lib/userError');
const traceAnalysis = require('./lib/traceAnalysis');
const store = require('./lib/sessionStore');
const candidateStore = require('./lib/candidateStore');
const rounds = require('./lib/rounds');
const interview = require('./lib/interview');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');
const DEFAULT_TRACE_DIR = path.resolve(__dirname, '..', 'traces');
const DEFAULT_SESSION_DIR = path.resolve(__dirname, '..', 'sessions');
const DEFAULT_CANDIDATE_DIR = path.resolve(__dirname, '..', 'candidates');

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
const MAX_RESUME_CHARS = 8000;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(new Error(`Invalid JSON body: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

function friendlyEngineError(err) {
  const msg = String((err && err.message) || err || 'Unknown error');
  if (/429|rate.?limit|too many requests/i.test(msg)) {
    return 'The AI provider rate-limited this request (429). It was retried automatically. Wait a few seconds and send your answer again — nothing was lost.';
  }
  if (/fetch failed|socket hang up|ECONNREFUSED|ENOTFOUND|network|ETIMEDOUT/i.test(msg)) {
    return 'Could not reach the AI provider (network error). Check your connection, then send your answer again — nothing was lost.';
  }
  return `The interview engine errored: ${msg}`;
}

function activeSessionSummary(s) {
  return {
    sessionId: s.id,
    mode: s.mode,
    practiceStage: s.practiceStage,
    stage: s.currentStageName,
    question: s.currentQuestion ? s.currentQuestion.text : null,
    isFollowUp: !!(s.currentQuestion && s.currentQuestion.isFollowUp),
    answers: [...s.triples.values()].reduce((n, arr) => n + arr.length, 0),
    startedAt: new Date(s.createdAt).toISOString(),
    awaiting: s.awaiting,
  };
}

function createServer({
  config = loadStageOrder(),
  callModel,
  transcriber = null,
  rng = Math.random,
  publicDir = PUBLIC_DIR,
  logger = console,
  traceStore = null,
  traceDir = DEFAULT_TRACE_DIR,
} = {}) {
  let liveCallModel = callModel;
  let callModelError = null;
  let liveTranscriber = transcriber;

  function getTranscriber() {
    if (!liveTranscriber) liveTranscriber = createTranscriber();
    return liveTranscriber;
  }

  function getCallModel() {
    if (liveCallModel) return liveCallModel;
    try {
      liveCallModel = createCallModel();
    } catch (err) {
      callModelError = err;
    }
    return liveCallModel;
  }

  const deps = (model) => {
    const base = { callModel: model, config, rng };
    if (traceStore) base.traceStore = traceStore;
    return interview.makeDeps(base);
  };

  function ensureModel(res) {
    const model = getCallModel();
    if (!model) {
      json(res, 500, { ok: false, error: callModelError.message });
      return null;
    }
    return model;
  }

  function stagesSummary() {
    return {
      stages: config.stages.map((s) => ({ name: s.name, minQuestions: s.minQuestions, mode: s.mode })),
      feedbackTiming: config.feedbackTiming,
      timeBudgetMinutes: config.timeBudgetMinutes,
      roundBudgetMinutes: config.roundBudgetMinutes,
      clarifyCapPerQuestion: config.clarifyCapPerQuestion,
    };
  }

  async function runCandidateDebrief(model, candidate) {
    const runDeps = deps(model);
    const sessionLike = { id: `debrief-${candidate.id || 'candidate'}` };
    const report = await interview.runDebrief({ candidate, deps: runDeps });
    let coachResult = { action_plan: [], priority_order: [] };
    try {
      coachResult = await interview.runCoachTraced({
        session: sessionLike,
        deps: runDeps,
        debriefOutput: report,
        candidateProfile: candidate.profile,
        transcriptExcerpts: candidate.qaHistory || [],
      });
    } catch (err) {
      logger.warn(`Coach failed for candidate debrief ${candidate.id}: ${err.message}`);
    }
    candidate.debriefReport = {
      report,
      action_plan: coachResult.action_plan,
      priority_order: coachResult.priority_order,
      stageVerdicts: candidate.stageVerdicts,
      coveredStages: [...candidate.coveredStages],
      at: Date.now(),
    };
    candidateStore.saveCandidate(candidate.id);
    return candidate.debriefReport;
  }

  function handleStart(body, res) {
    const model = ensureModel(res);
    if (!model) return;
    const mode = body.mode === 'practice' ? 'practice' : 'mock';
    const practiceStage = body.stage || null;
    if (mode === 'practice' && !config.stages.some((s) => s.name === practiceStage)) {
      return json(res, 400, { ok: false, error: `Unknown stage '${practiceStage}'.` });
    }

    let candidate = null;
    const requestedCandidate = typeof body.candidateId === 'string' ? body.candidateId : '';
    if (mode === 'practice') {
      if (requestedCandidate) {
        candidate = candidateStore.getCandidate(requestedCandidate);
        if (!candidate) {
          return json(res, 400, { ok: false, error: `Unknown candidate '${requestedCandidate}'.` });
        }
      } else {
        candidate = candidateStore.createCandidate({
          targetRoleAndLevel: typeof body.targetRole === 'string' ? body.targetRole : '',
          resume: typeof body.resume === 'string' ? body.resume.trim().slice(0, MAX_RESUME_CHARS) : '',
        });
      }
    }

    const feedbackMode = body.feedback === 'simulation' ? 'simulation' : 'full';
    const targetRole = typeof body.targetRole === 'string' && body.targetRole.trim()
      ? body.targetRole
      : candidate
        ? candidate.targetRoleAndLevel
        : '';
    const resume = typeof body.resume === 'string' && body.resume.trim()
      ? body.resume.trim().slice(0, MAX_RESUME_CHARS)
      : candidate
        ? candidate.resume
        : '';

    const session = store.createSession({
      mode,
      practiceStage,
      candidateId: candidate ? candidate.id : null,
      feedbackMode,
      targetRoleAndLevel: targetRole,
      resume,
    });
    if (candidate && candidate.profile.length) {
      session.profile = candidate.profile.slice();
    }
    const payload = interview.begin(session, deps(model));
    payload.candidate = rounds.candidatePayload(candidate, config);
    store.saveSession(session.id);
    return json(res, 200, payload);
  }

  function handleAnswer(body, res) {
    const model = ensureModel(res);
    if (!model) return;
    const session = store.getSession(String(body.sessionId || ''));
    if (!session) {
      return json(res, 404, { ok: false, error: 'Session not found. Start a new interview.' });
    }
    if (typeof body.answer !== 'string' || body.answer.trim().length === 0) {
      return json(res, 400, { ok: false, error: 'Answer cannot be empty.' });
    }
    if (session.awaiting !== 'answer') {
      return json(res, 409, { ok: false, error: 'This session is not waiting for an answer.' });
    }
    const answerText = body.answer.trim();
    const runDeps = deps(model);
    const handle = async () => {
      const stageCfg = config.stages.find((s) => s.name === session.currentStageName) || { mode: 'none' };
      if (stageCfg.mode !== 'none') {
        const kind = await interview.classifyTurn({ deps: runDeps, session, text: answerText });
        if (kind === 'clarify') {
          return interview.processClarify({ session, clarifyText: answerText, deps: runDeps });
        }
      }
      return interview.processAnswer({ session, answerText, deps: runDeps });
    };
    handle()
      .then(async (payload) => {
        store.saveSession(session.id);
        if (session.mode === 'practice' && session.candidateId) {
          const candidate = candidateStore.getCandidate(session.candidateId);
          if (candidate) {
            if (payload.state === 'final_report') {
              rounds.mergeSessionIntoCandidate(candidate, session);
              candidateStore.saveCandidate(candidate.id);
              const cov = rounds.coverage(candidate, config);
              if (cov.done) {
                if (candidate.debriefReport) {
                  payload.debrief = candidate.debriefReport;
                } else {
                  payload.debrief = await runCandidateDebrief(model, candidate);
                }
              }
            }
            payload.candidate = rounds.candidatePayload(candidate, config);
          }
        }
        json(res, 200, payload);
      })
      .catch((err) => {
        if (isUserError(err)) {
          return json(res, err.statusCode || 400, { ok: false, error: err.message });
        }
        logger.error('handleAnswer failed:', err);
        json(res, 502, { ok: false, error: friendlyEngineError(err) });
      });
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /' || route === 'GET /index.html') {
      fs.readFile(INDEX_FILE, (err, data) => {
        if (err) return json(res, 500, { ok: false, error: 'index.html missing' });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(data);
      });
      return;
    }

    if (route === 'GET /api/health') {
      json(res, 200, { ok: true });
      return;
    }

    if (route === 'GET /api/stages') {
      json(res, 200, { ok: true, ...stagesSummary() });
      return;
    }

    if (route === 'GET /api/transcribe/config') {
      try {
        const t = getTranscriber();
        json(res, 200, {
          ok: true,
          enabled: t.enabled,
          provider: t.provider,
          model: t.model,
          language: t.language,
        });
      } catch (err) {
        json(res, 200, { ok: false, enabled: false, error: err.message });
      }
      return;
    }

    if (route === 'GET /api/traces') {
      json(res, 200, { ok: true, traces: traceAnalysis.listTraces(traceDir) });
      return;
    }

    const traceMatch = /^GET \/api\/traces\/([A-Za-z0-9._-]+)$/.exec(route);
    if (traceMatch) {
      const trace = traceAnalysis.readTrace(traceDir, decodeURIComponent(traceMatch[1]));
      if (!trace) return json(res, 404, { ok: false, error: 'Trace not found.' });
      return json(res, 200, { ok: true, ...trace });
    }

    if (route === 'GET /api/sessions') {
      json(res, 200, {
        ok: true,
        sessions: store.list().filter((s) => s.awaiting === 'answer').map(activeSessionSummary),
      });
      return;
    }

    const sessionMatch = /^GET \/api\/sessions\/([A-Za-z0-9._-]+)$/.exec(route);
    if (sessionMatch) {
      const session = store.getSession(decodeURIComponent(sessionMatch[1]));
      if (!session || session.awaiting !== 'answer') {
        return json(res, 404, { ok: false, error: 'Active session not found.' });
      }
      const payload = interview.resume(session, deps(null));
      const candidate = session.candidateId ? candidateStore.getCandidate(session.candidateId) : null;
      if (candidate) payload.candidate = rounds.candidatePayload(candidate, config);
      return json(res, 200, payload);
    }

    if (route === 'POST /api/start') {
      readJsonBody(req)
        .then((body) => handleStart(body, res))
        .catch((err) => json(res, 400, { ok: false, error: err.message }));
      return;
    }

    if (route === 'GET /api/candidates') {
      const list = candidateStore
        .list()
        .map((c) => rounds.candidatePayload(c, config))
        .filter(Boolean)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      json(res, 200, { ok: true, candidates: list });
      return;
    }

    const candidateMatch = /^GET \/api\/candidates\/([A-Za-z0-9._-]+)$/.exec(route);
    if (candidateMatch) {
      const candidate = candidateStore.getCandidate(decodeURIComponent(candidateMatch[1]));
      if (!candidate) {
        return json(res, 404, { ok: false, error: 'Candidate not found.' });
      }
      return json(res, 200, { ok: true, candidate: rounds.candidateDetailPayload(candidate, config) });
    }

    if (route === 'POST /api/candidates') {
      readJsonBody(req)
        .then((body) => {
          const model = ensureModel(res);
          if (!model) return;
          const candidate = candidateStore.createCandidate({
            targetRoleAndLevel: typeof body.targetRole === 'string' ? body.targetRole : '',
            resume: typeof body.resume === 'string' ? body.resume.trim().slice(0, MAX_RESUME_CHARS) : '',
          });
          return json(res, 200, { ok: true, candidate: rounds.candidatePayload(candidate, config) });
        })
        .catch((err) => json(res, 400, { ok: false, error: err.message }));
      return;
    }

    if (route === 'POST /api/debrief') {
      readJsonBody(req)
        .then((body) => {
          const model = ensureModel(res);
          if (!model) return;
          const candidate = candidateStore.getCandidate(String(body.candidateId || ''));
          if (!candidate) {
            return json(res, 404, { ok: false, error: 'Candidate not found.' });
          }
          runCandidateDebrief(model, candidate)
            .then((debrief) =>
              json(res, 200, { ok: true, debrief, candidate: rounds.candidatePayload(candidate, config) })
            )
            .catch((err) => {
              logger.error('debrief failed:', err);
              json(res, 502, { ok: false, error: friendlyEngineError(err) });
            });
        })
        .catch((err) => json(res, 400, { ok: false, error: err.message }));
      return;
    }

    if (route === 'POST /api/answer') {
      readJsonBody(req)
        .then((body) => handleAnswer(body, res))
        .catch((err) => json(res, 400, { ok: false, error: err.message }));
      return;
    }

    if (route === 'POST /api/transcribe') {
      readJsonBody(req, Math.ceil(MAX_AUDIO_BYTES * 1.4))
        .then((body) => {
          let t;
          try {
            t = getTranscriber();
          } catch (err) {
            return json(res, 503, { ok: false, error: err.message });
          }
          if (!t.enabled) {
            return json(res, 503, {
              ok: false,
              error: `Voice input is not configured. Set STT_PROVIDER and ${t.envKey} in .env to enable it.`,
            });
          }
          const audio = typeof body.audio === 'string' ? Buffer.from(body.audio, 'base64') : null;
          if (!audio || audio.length === 0) {
            return json(res, 400, { ok: false, error: 'No audio received.' });
          }
          const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
          const contentType = typeof body.contentType === 'string' ? body.contentType : '';
          const recordTrace = (record) => {
            if (traceStore && sessionId) {
              traceStore.recordCall({ sessionId, record: { label: 'stt', provider: t.provider, model: t.model, ...record } });
            }
          };
          return t
            .transcribe({ audio, contentType })
            .then(({ transcript, costUsd }) => {
              recordTrace({ success: true, costUsd });
              json(res, 200, { ok: true, transcript });
            })
            .catch((err) => {
              recordTrace({ success: false, error: String(err.message).slice(0, 300) });
              logger.warn(`STT (${t.provider}) failed: ${err.message}`);
              json(res, err.statusCode || 502, { ok: false, error: err.message });
            });
        })
        .catch((err) => json(res, 400, { ok: false, error: err.message }));
      return;
    }

    json(res, 404, { ok: false, error: 'Not found' });
  });
}

if (require.main === module) {
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '127.0.0.1';
  const cfg = loadStageOrder();
  let traceStore = null;
  try {
    traceStore = createTraceStore({ rootDir: process.env.TRACE_DIR || DEFAULT_TRACE_DIR });
  } catch (err) {
    console.warn(`Tracing disabled: ${err.message}. Set TRACE_DIR to enable.`);
  }
  try {
    store.setPersist(createSessionFileStore({ rootDir: process.env.SESSION_DIR || DEFAULT_SESSION_DIR }));
    const loaded = store.loadPersisted();
    console.log(
      `Sessions persist to: ${process.env.SESSION_DIR || DEFAULT_SESSION_DIR} (${loaded} resumed)`
    );
  } catch (err) {
    console.warn(`Session persistence disabled: ${err.message}. Sessions live in memory only.`);
  }
  try {
    candidateStore.setPersist(
      createCandidateFileStore({ rootDir: process.env.CANDIDATE_DIR || DEFAULT_CANDIDATE_DIR })
    );
    const loaded = candidateStore.loadPersisted();
    console.log(
      `Candidates persist to: ${process.env.CANDIDATE_DIR || DEFAULT_CANDIDATE_DIR} (${loaded} loaded)`
    );
  } catch (err) {
    console.warn(`Candidate persistence disabled: ${err.message}. Candidates live in memory only.`);
  }
  const server = createServer({ traceStore });
  server.listen(port, host, () => {
    console.log(`PM interview prep running at http://${host}:${port}`);
    console.log(`AI provider: ${process.env.AI_PROVIDER || DEFAULT_PROVIDER} (set AI_PROVIDER to switch)`);
    console.log(`Stages: ${cfg.stages.map((s) => s.name).join(' → ')} — ${cfg.feedbackTiming} feedback`);
    if (traceStore) console.log(`Model calls traced to: ${traceStore.rootDir}`);
  });
}

module.exports = { createServer };