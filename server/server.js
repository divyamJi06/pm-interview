const http = require('http');
const fs = require('fs');
const path = require('path');

const { loadEnvIntoProcess } = require('./lib/loadEnv');
loadEnvIntoProcess();

const { loadStageOrder } = require('./config/stageOrder');
const { getTrack, listTracks } = require('./config/tracks');
const { loadStage } = require('./lib/loadStage');
const { loadResourceBank } = require('./lib/resourceBank');
const { createCallModel, DEFAULT_PROVIDER } = require('./lib/callModel');
const { createTranscriber } = require('./lib/transcribe');
const { createSpeaker } = require('./lib/speech');
const { createTraceStore } = require('./lib/traceStore');
const { createSessionFileStore } = require('./lib/sessionFileStore');
const { createSessionKeyStore } = require('./lib/sessionKeyFileStore');
const { createCandidateFileStore } = require('./lib/candidateFileStore');
const { isUserError } = require('./lib/userError');
const { createUserVerifier, bearerFrom, ownsSession } = require('./lib/auth');
const { fillTemplate } = require('./lib/promptFiller');
const traceAnalysis = require('./lib/traceAnalysis');
const store = require('./lib/sessionStore');
const candidateStore = require('./lib/candidateStore');
const rounds = require('./lib/rounds');
const interview = require('./lib/interview');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const REACT_DIST_DIR = path.resolve(__dirname, '..', 'frontend', 'dist');
const DEFAULT_TRACE_DIR = path.resolve(__dirname, '..', 'traces');
const DEFAULT_SESSION_DIR = path.resolve(__dirname, '..', 'sessions');
const DEFAULT_CANDIDATE_DIR = path.resolve(__dirname, '..', 'candidates');

const STATIC_TYPES = {
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  map: 'application/json; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  txt: 'text/plain; charset=utf-8',
};
const INDEX_TYPES = { html: 'text/html; charset=utf-8' };

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
const MAX_RESUME_CHARS = 8000;

// Bring-your-own-key. The candidate's Cohere key arrives with the request that
// needs it and is held against the session id, and mirrored to a sidecar file
// (`.keys.json` next to the sessions) so a restart does not orphan a key
// mid-round. It is never written into the session records themselves and never
// echoed back to a client.
const sessionKeys = new Map();

// Set up in main() from the sidecar file; stays null in tests, where nothing is
// persisted.
let sessionKeysStore = null;

function persistSessionKeys() {
  if (!sessionKeysStore) return;
  sessionKeysStore.save(Object.fromEntries(sessionKeys));
}

function rememberSessionKeys(sessionId, { llm, stt }) {
  const entry = { llm: cleanKey(llm), stt: cleanKey(stt) };
  if (!entry.llm && !entry.stt) {
    sessionKeys.delete(sessionId);
  } else {
    sessionKeys.set(sessionId, entry);
  }
  persistSessionKeys();
  return entry;
}

  // Only Cohere is offered in the UI, so only Cohere is accepted here. An
  // unexpected provider is rejected rather than silently forwarded.
  const BYOK_PROVIDER = 'cohere';
  const STT_PROVIDERS = new Set(['cohere', 'openai', 'deepgram']);

  function requestedSttProvider(value) {
    const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return STT_PROVIDERS.has(name) ? name : '';
  }
function cleanKey(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 200);
}

function rememberSessionKeys(sessionId, { llm, stt }) {
  const entry = { llm: cleanKey(llm), stt: cleanKey(stt) };
  if (!entry.llm && !entry.stt) {
    sessionKeys.delete(sessionId);
    return entry;
  }
  sessionKeys.set(sessionId, entry);
  return entry;
}

function sessionKeysFor(sessionId) {
  return sessionKeys.get(sessionId) || { llm: '', stt: '' };
}

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
    track: s.trackId || 'pm',
  };
}

function createServer({
  config = null,
  callModel,
  // Injectable so a test can observe the key a candidate brought without
  // reaching Cohere. Defaults to the real factory.
  callModelFactory = createCallModel,
  transcriber = null,
  // Same reasoning for speech: the per-request transcriber is built from the
  // candidate's own key, and a test needs to watch that without calling Cohere.
  transcriberFactory = createTranscriber,
  // Injectable for the same reason: auth is exercised against a stub, not
  // against a live Supabase project.
  verifier = null,
  speaker = null,
  rng = Math.random,
  publicDir = PUBLIC_DIR,
  logger = console,
  traceStore = null,
  traceDir = DEFAULT_TRACE_DIR,
  deferFinalReport = false,
} = {}) {
  let liveCallModel = callModel;
  let callModelError = null;
  // Held only so tests can inject a stub. Live requests build a transcriber per
  // request, because the key and the provider both depend on the caller.
  let liveTranscriber = transcriber;
  let liveSpeaker = speaker;
  // Resolves the caller's access token to a user id, or reports that this
  // deployment is not checking. Created once so its verification cache survives
  // across requests.
  const authVerifier = verifier || createUserVerifier();

  function getSpeaker() {
    if (!liveSpeaker) liveSpeaker = createSpeaker();
    return liveSpeaker;
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

  // A model bound to the key the candidate supplied for this session. The
  // server deliberately has no fallback key of its own: whoever runs an
  // interview pays for it, so running one without a key is an error, not a bill
  // to the deployment owner.
  function modelForSession(sessionId) {
    const { llm } = sessionKeysFor(sessionId);
    if (llm) {
      try {
        return {
          model: callModelFactory({ provider: BYOK_PROVIDER, apiKey: llm, maxTokens: 4096, temperature: 0 }),
          error: null,
        };
      } catch (err) {
        return { model: null, error: err };
      }
    }
    // No candidate key. A deployment that injected a model (a test harness) may
    // serve its own; a live server must not, or the chat quietly bills the
    // owner. Ask for the key instead.
    if (callModel) return { model: getCallModel(), error: callModelError };
    return {
      model: null,
      error: new Error('No AI key on this session. Add your Cohere key in Settings → AI services, then start a new interview.'),
    };
  }

  // Builds a transcriber for one request. The candidate's speech key is held
  // against the session, so a recording only has to carry the session id — the
  // key does not travel with every clip. A key in the body wins, which is how a
  // client that has not started a session yet can still record.
  //
  // The provider is taken from the request when the client knows it is on
  // Cohere, because the client has to convert the audio format to match, and a
  // Chrome webm clip is rejected by Cohere but fine for Deepgram.
  function transcriberForRequest(sessionId, body) {
    const key = cleanKey(body && body.apiKey) || sessionKeysFor(sessionId).stt;
    const asked = requestedSttProvider(body && body.provider) || requestedSttProvider(body && body.queryProvider);
    const provider = asked || (key ? BYOK_PROVIDER : process.env.STT_PROVIDER || 'deepgram');
    return transcriberFactory({ provider, apiKey: key || undefined });
  }

  function trackFor(trackId) {
    const track = getTrack(trackId);
    if (config) return { ...track, config };
    return track;
  }

  const deps = (model, trackRecord) => {
    const resolved = trackRecord || trackFor('pm');
    const stageCfgFor = (name) => resolved.config.stages.find((s) => s.name === name);
    const base = {
      callModel: model,
      config: resolved.config,
      trackTokens: resolved.tokens,
      templateFiller: (template, data) => fillTemplate(template, { ...resolved.tokens, ...data }),
      rng,
      deferFinalReport,
    };
    if (resolved.stagesDir) {
      base.loadStageFn = (name) => loadStage(name, { dataDir: resolved.stagesDir, mode: (stageCfgFor(name) || {}).mode });
    }
    if (resolved.resourcesDir) base.resourceBankReader = () => loadResourceBank({ dataDir: resolved.resourcesDir });
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

  function stagesSummary(cfg) {
    return {
      stages: cfg.stages.map((s) => ({ name: s.name, minQuestions: s.minQuestions, mode: s.mode })),
      feedbackTiming: cfg.feedbackTiming,
      timeBudgetMinutes: cfg.timeBudgetMinutes,
      roundBudgetMinutes: cfg.roundBudgetMinutes,
      clarifyCapPerQuestion: cfg.clarifyCapPerQuestion,
    };
  }

  async function runCandidateDebrief(model, candidate) {
    const track = trackFor(candidate.trackId);
    const runDeps = deps(model, track);
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

  function handleStart(body, res, auth) {
    // The candidate's own key is used for the very first call, which happens
    // inside interview.begin below, before there is a session id to hang it on.
    const ownKey = cleanKey(body.apiKey);
    let model = null;
    let modelError = null;
    if (ownKey) {
      try {
        model = callModelFactory({ provider: BYOK_PROVIDER, apiKey: ownKey });
      } catch (err) {
        modelError = err;
      }
    } else if (callModel) {
      // Only a deployment that injected a model (tests do) may serve one to a
      // candidate who brought no key. A live server never falls back to its own
      // key, so a missing key is an error instead of a bill to the owner.
      model = getCallModel();
      modelError = callModelError;
    } else {
      model = null;
      modelError = new Error('No AI key in your profile yet. Add your Cohere key in Settings → AI services, then start the interview again.');
    }
    if (!model) {
      json(res, 500, { ok: false, error: modelError ? modelError.message : 'No AI provider configured.' });
      return;
    }
    // Every round is a single-stage mock. The old multi-stage "full mock" walk is
    // gone, so `mode` is always 'mock' and a stage is always required.
    const mode = 'mock';
    const practiceStage = body.stage || null;
    const track = trackFor(typeof body.track === 'string' ? body.track : 'pm');
    if (!track.config.stages.some((s) => s.name === practiceStage)) {
      return json(res, 400, { ok: false, error: `Unknown stage '${practiceStage}'.` });
    }

    let candidate = null;
    const requestedCandidate = typeof body.candidateId === 'string' ? body.candidateId : '';
    if (requestedCandidate) {
      candidate = candidateStore.getCandidate(requestedCandidate);
      if (!candidate) {
        return json(res, 400, { ok: false, error: `Unknown candidate '${requestedCandidate}'.` });
      }
    } else {
      candidate = candidateStore.createCandidate({
        trackId: track.id,
        targetRoleAndLevel: typeof body.targetRole === 'string' ? body.targetRole : '',
        resume: typeof body.resume === 'string' ? body.resume.trim().slice(0, MAX_RESUME_CHARS) : '',
      });
    }

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
      trackId: track.id,
      mode,
      practiceStage,
      candidateId: candidate ? candidate.id : null,
      feedbackMode: 'full',
      targetRoleAndLevel: targetRole,
      resume,
      // The verified id wins. The one in the body is only used when this
      // deployment has no Supabase to verify against.
      userId: auth && auth.userId
        ? auth.userId
        : typeof body.userId === 'string'
          ? body.userId.slice(0, 64)
          : null,
    });
    rememberSessionKeys(session.id, { llm: ownKey, stt: cleanKey(body.sttApiKey) });
    if (candidate && candidate.profile.length) {
      session.profile = candidate.profile.slice();
    }
    const payload = interview.begin(session, deps(model, track));
    payload.candidate = rounds.candidatePayload(candidate, track.config);
    store.saveSession(session.id);
    return json(res, 200, payload);
  }

  function handleAnswer(body, res, auth) {
    const session = store.getSession(String(body.sessionId || ''));
    if (!session) {
      return json(res, 404, { ok: false, error: 'Session not found. Start a new interview.' });
    }
    if (!ownsSession(session, auth)) {
      return json(res, 403, { ok: false, error: 'That interview belongs to another candidate.' });
    }
    // A session started before the candidate had a key can still adopt one they
    // now hold in Settings: the client resends it, and it binds here only when
    // nothing is bound yet.
    let { model, error: modelError } = modelForSession(session.id);
    if (!model && cleanKey(body.apiKey)) {
      rememberSessionKeys(session.id, { llm: cleanKey(body.apiKey), stt: '' });
      try {
        model = callModelFactory({ provider: BYOK_PROVIDER, apiKey: cleanKey(body.apiKey) });
        modelError = null;
      } catch (err) {
        modelError = err;
      }
    }
    if (!model) {
      return json(res, 500, { ok: false, error: modelError ? modelError.message : 'No AI provider configured.' });
    }
    if (typeof body.answer !== 'string' || body.answer.trim().length === 0) {
      return json(res, 400, { ok: false, error: 'Answer cannot be empty.' });
    }
    if (session.awaiting !== 'answer') {
      return json(res, 409, { ok: false, error: 'This session is not waiting for an answer.' });
    }
    const answerText = body.answer.trim();
    const track = trackFor(session.trackId);
    const runDeps = deps(model, track);
    const answeredAt = Date.now();
    let answerCost = 0;
    if (runDeps.traceStore && typeof runDeps.traceStore.recordCall === 'function') {
      const inner = runDeps.traceStore.recordCall.bind(runDeps.traceStore);
      runDeps.traceStore.recordCall = (arg) => {
        answerCost += (arg && arg.record && arg.record.costUsd) || 0;
        return inner(arg);
      };
    }
    const handle = async () => {
      const stageCfg = track.config.stages.find((s) => s.name === session.currentStageName) || { mode: 'none' };
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
        const latencyMs = Date.now() - answeredAt;
        const costUsd = Math.round(answerCost * 10000) / 10000;
        payload.answerMeta = { latencyMs, costUsd };
        if (runDeps.traceStore && typeof runDeps.traceStore.recordAnswer === 'function') {
          runDeps.traceStore.recordAnswer({
            sessionId: session.id,
            record: {
              stage: session.currentStageName,
              mode: session.mode,
              latencyMs,
              costUsd,
              state: payload.state,
            },
          });
        }
        store.saveSession(session.id);
        if (session.candidateId) {
          const candidate = candidateStore.getCandidate(session.candidateId);
          if (candidate) {
            if (payload.state === 'final_report') {
              rounds.mergeSessionIntoCandidate(candidate, session);
              candidateStore.saveCandidate(candidate.id);
              const cov = rounds.coverage(candidate, track.config);
              if (cov.done) {
                if (candidate.debriefReport) {
                  payload.debrief = candidate.debriefReport;
                } else {
                  payload.debrief = await runCandidateDebrief(model, candidate);
                }
              }
            }
            payload.candidate = rounds.candidatePayload(candidate, track.config);
          }
        }
        if (payload.state === 'analyzing') {
          scheduleFinalReport(session, model);
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

  const analysisPending = new Set();

  function scheduleFinalReport(session, model) {
    if (analysisPending.has(session.id)) return;
    analysisPending.add(session.id);
    const runDeps = deps(model, trackFor(session.trackId));
    Promise.resolve()
      .then(() => runFinalReport(session, runDeps, model))
      .catch((err) => logger.error(`Final report analysis failed for session ${session.id}:`, err))
      .finally(() => analysisPending.delete(session.id));
  }

  async function runFinalReport(session, runDeps, model) {
    const payload = await interview.finalizeSession(session, runDeps);
    const track = trackFor(session.trackId);
    if (session.candidateId) {
      const candidate = candidateStore.getCandidate(session.candidateId);
      if (candidate) {
        rounds.mergeSessionIntoCandidate(candidate, session);
        candidateStore.saveCandidate(candidate.id);
        const cov = rounds.coverage(candidate, track.config);
        if (cov.done) {
          if (candidate.debriefReport) {
            payload.debrief = candidate.debriefReport;
          } else {
            payload.debrief = await runCandidateDebrief(model, candidate);
          }
        }
        payload.candidate = rounds.candidatePayload(candidate, track.config);
      }
    }
    session.finalPayload = payload;
    store.saveSession(session.id);
    logger.info(`Final report ready for session ${session.id}`);
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;

    // The built React app wins when it exists, so `node server/server.js` serves the
    // revamp instead of the old public/index.html monolith. publicDir stays the
    // fallback and the seam tests use.
    const appDir = fs.existsSync(path.join(REACT_DIST_DIR, 'index.html')) ? REACT_DIST_DIR : publicDir;

    if (route === 'GET /' || route === 'GET /index.html') {
      fs.readFile(path.join(appDir, 'index.html'), (err, data) => {
        if (err) return json(res, 500, { ok: false, error: 'index.html missing' });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(data);
      });
      return;
    }

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const target = path.resolve(appDir, rel);
      const inside = target === appDir || target.startsWith(appDir + path.sep);
      const ext = path.extname(target).slice(1).toLowerCase();
      if (inside && ext && STATIC_TYPES[ext] && fs.existsSync(target) && fs.statSync(target).isFile()) {
        fs.readFile(target, (err, data) => {
          if (err) return json(res, 500, { ok: false, error: 'static file error' });
          res.writeHead(200, {
            'content-type': STATIC_TYPES[ext],
            'cache-control': ext === 'html' ? 'no-store' : 'public, max-age=3600',
          });
          res.end(data);
        });
        return;
      }
      // Client-side routes such as /app/profile have no extension: hand back the
      // shell and let the router resolve them.
      if (inside && !ext) {
        fs.readFile(path.join(appDir, 'index.html'), (err, data) => {
          if (err) return json(res, 404, { ok: false, error: 'not found' });
          res.writeHead(200, { 'content-type': INDEX_TYPES.html, 'cache-control': 'no-store' });
          res.end(data);
        });
        return;
      }
    }

    if (route === 'GET /api/health') {
      json(res, 200, { ok: true, auth: authVerifier.state() });
      return;
    }

    if (route === 'GET /api/stages') {
      const track = trackFor(url.searchParams.get('track') || 'pm');
      json(res, 200, { ok: true, track: track.id, ...stagesSummary(track.config) });
      return;
    }

    if (route === 'GET /api/tracks') {
      json(res, 200, { ok: true, tracks: listTracks() });
      return;
    }

    // Everything past this point can spend a key, read a transcript or change a
    // session, so it needs to know who is asking. `auth` is carried through to
    // the handlers that own something, so they can check it belongs to them.
    let auth = null;
    if (url.pathname.startsWith('/api/')) {
      // A verifier failure (e.g. Supabase unreachable) must never kill the
      // socket before the response: the browser would see a bare 500 and the
      // recording the candidate just made would be gone. Surface it as a
      // retryable error instead.
      auth = await authVerifier.verify(bearerFrom(req)).catch((err) => ({
        ok: false,
        status: 503,
        error: 'Could not verify your session. Try again in a moment.',
      }));
      if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error, signIn: auth.status === 401 });
    }

    if (route === 'GET /api/transcribe/config') {
      try {
        // Asked with a session id and a provider so a candidate who brought
        // their own Cohere key is told voice is on, and is told to record in a
        // format Cohere accepts, even when the server has no key in .env.
        const sessionId = url.searchParams.get('sessionId') || '';
        const t =
          liveTranscriber || transcriberForRequest(sessionId, { provider: url.searchParams.get('provider') });
        json(res, 200, {
          ok: true,
          enabled: t.enabled,
          provider: t.provider,
          model: t.model,
          language: t.language,
          byok: Boolean(sessionKeysFor(sessionId).stt),
        });
      } catch (err) {
        json(res, 200, { ok: false, enabled: false, error: err.message });
      }
      return;
    }

    // POST variant lets the key ride in the body instead of the URL, so a
    // candidate's key is never logged in a query string. Without it the server
    // reports voice disabled until a session bound to that key exists.
    if (route === 'POST /api/transcribe/config') {
      try {
        const body = await readJsonBody(req);
        const t = liveTranscriber || transcriberForRequest(String(body.sessionId || ''), body);
        json(res, 200, {
          ok: true,
          enabled: t.enabled,
          provider: t.provider,
          model: t.model,
          language: t.language,
          byok: Boolean(sessionKeysFor(String(body.sessionId || '')).stt),
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
      // Filtered by whoever is actually calling, not by the id in the query
      // string: that one is a claim. Sessions with no owner predate accounts, so
      // under enforcement they belong to nobody and are left out; without
      // enforcement a local install still sees them all.
      const userId = auth.enforced ? auth.userId : url.searchParams.get('userId');
      const mine = (s) => {
        if (auth.enforced) return s.userId === userId;
        return !userId || !s.userId || s.userId === userId;
      };
      json(res, 200, {
        ok: true,
        sessions: store
          .list()
          .filter((s) => s.awaiting === 'answer' && mine(s))
          .map(activeSessionSummary),
      });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/report/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/report/'.length));
      const session = store.getSession(id);
      if (!session) {
        return json(res, 404, { ok: false, error: 'Session not found.' });
      }
      if (!ownsSession(session, auth)) {
        return json(res, 403, { ok: false, error: 'That interview belongs to another candidate.' });
      }
      if (!session.finalPayload && session.awaiting === 'final_report') {
        // With the session's key, so a candidate who brought their own does not
        // have the closing report quietly billed to the server's account. No
        // key at all is an error, not a silently stuck report.
        const { model, error: modelError } = modelForSession(session.id);
        if (!model) {
          return json(res, 500, { ok: false, error: modelError ? modelError.message : 'No AI provider configured.' });
        }
        scheduleFinalReport(session, model);
      }
      if (!session.finalPayload) {
        return json(res, 200, { ok: true, state: 'analyzing' });
      }
      return json(res, 200, { ok: true, state: 'final_report', ...session.finalPayload });
    }

    const sessionMatch = /^GET \/api\/sessions\/([A-Za-z0-9._-]+)$/.exec(route);
    if (sessionMatch) {
      const session = store.getSession(decodeURIComponent(sessionMatch[1]));
      if (!session || session.awaiting !== 'answer') {
        return json(res, 404, { ok: false, error: 'Active session not found.' });
      }
      if (!ownsSession(session, auth)) {
        return json(res, 403, { ok: false, error: 'That interview belongs to another candidate.' });
      }
      const track = trackFor(session.trackId);
      const payload = interview.resume(session, deps(null, track));
      const candidate = session.candidateId ? candidateStore.getCandidate(session.candidateId) : null;
      if (candidate) payload.candidate = rounds.candidatePayload(candidate, track.config);
      return json(res, 200, payload);
    }

    if (route === 'POST /api/start') {
      readJsonBody(req)
        .then((body) => handleStart(body, res, auth))
        .catch((err) => json(res, 400, { ok: false, error: err.message }));
      return;
    }

    if (route === 'GET /api/candidates') {
      const list = candidateStore
        .list()
        .map((c) => rounds.candidatePayload(c, trackFor(c.trackId).config))
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
      return json(res, 200, { ok: true, candidate: rounds.candidateDetailPayload(candidate, trackFor(candidate.trackId).config) });
    }

    if (route === 'POST /api/candidates') {
      readJsonBody(req)
        .then((body) => {
          const model = ensureModel(res);
          if (!model) return;
          const track = trackFor(typeof body.track === 'string' ? body.track : 'pm');
          const candidate = candidateStore.createCandidate({
            trackId: track.id,
            targetRoleAndLevel: typeof body.targetRole === 'string' ? body.targetRole : '',
            resume: typeof body.resume === 'string' ? body.resume.trim().slice(0, MAX_RESUME_CHARS) : '',
          });
          return json(res, 200, { ok: true, candidate: rounds.candidatePayload(candidate, track.config) });
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
          const track = trackFor(candidate.trackId);
          runCandidateDebrief(model, candidate)
            .then((debrief) =>
              json(res, 200, { ok: true, debrief, candidate: rounds.candidatePayload(candidate, track.config) })
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
        .then((body) => handleAnswer(body, res, auth))
        .catch((err) => json(res, 400, { ok: false, error: err.message }));
      return;
    }

    if (route === 'POST /api/transcribe') {
      readJsonBody(req, Math.ceil(MAX_AUDIO_BYTES * 1.4))
        .then((body) => {
          const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
          // Recording costs the candidate's own key, so it is checked as strictly
          // as spending their key on an answer.
          const session = store.getSession(sessionId);
          if (session && !ownsSession(session, auth)) {
            return json(res, 403, { ok: false, error: 'That interview belongs to another candidate.' });
          }
          let t;
          try {
            // The candidate's speech key is held against the session, so a
            // recording only has to carry the session id — the key does not
            // travel with every clip. A key in the body wins, which is how the
            // interview view sends one for a session it has just resumed.
            t = liveTranscriber || transcriberForRequest(sessionId, body);
          } catch (err) {
            return json(res, 503, { ok: false, error: err.message });
          }
          if (!t.enabled) {
            return json(res, 503, {
              ok: false,
              error:
                t.provider === BYOK_PROVIDER
                  ? 'Voice input needs a Cohere API key. Add one in Settings before recording an answer.'
                  : 'Voice input is off in this deployment. No server key is used: add your speech key in Settings → AI services, then start a fresh interview.',
            });
          }
          const audio = typeof body.audio === 'string' ? Buffer.from(body.audio, 'base64') : null;
          if (!audio || audio.length === 0) {
            return json(res, 400, { ok: false, error: 'No audio received.' });
          }
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

    if (route === 'GET /api/tts/config') {
      try {
        const s = getSpeaker();
        const serverEngine = s.enabled && !!process.env.TTS_PROVIDER;
        json(res, 200, {
          ok: true,
          enabled: s.enabled,
          provider: s.provider,
          model: s.model,
          voice: s.voice,
          engine: serverEngine ? 'server' : 'browser',
          maxTextChars: s.maxTextChars,
        });
      } catch (err) {
        json(res, 200, { ok: false, enabled: false, engine: 'browser', error: err.message });
      }
      return;
    }

    if (route === 'POST /api/tts') {
      readJsonBody(req)
        .then((body) => {
          const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
          let s;
          try {
            // Server voice only for an operator who opted in via TTS_PROVIDER
            // and a request that carries a key. The server has no key of its
            // own: a candidate brings theirs, or the browser speaks instead.
            s =
              liveSpeaker ||
              createSpeaker({
                provider: process.env.TTS_PROVIDER,
                apiKey: cleanKey(body.apiKey) || sessionKeysFor(sessionId).tts || undefined,
              });
          } catch (err) {
            return json(res, 503, { ok: false, error: err.message });
          }
          if (!s.enabled || !process.env.TTS_PROVIDER) {
            return json(res, 503, {
              ok: false,
              error:
                'Server-side voice is off in this deployment. An operator who wants it sets TTS_PROVIDER in the server env; you can still add your speech key in Settings → AI services. Until then the browser speaks.',
            });
          }
          const text = typeof body.text === 'string' ? body.text.trim() : '';
          const recordTrace = (record) => {
            if (traceStore && sessionId) {
              traceStore.recordCall({ sessionId, record: { label: 'tts', provider: s.provider, model: s.model, ...record } });
            }
          };
          const startedAt = Date.now();
          return s
            .speak({ text })
            .then(({ audio, contentType, costUsd }) => {
              recordTrace({
                success: true,
                costUsd,
                prompt: text,
                durationMs: Date.now() - startedAt,
              });
              json(res, 200, { ok: true, audio: audio.toString('base64'), contentType });
            })
            .catch((err) => {
              recordTrace({ success: false, error: String(err.message).slice(0, 300), prompt: text });
              logger.warn(`TTS (${s.provider}) failed: ${err.message}`);
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
    try {
      sessionKeysStore = createSessionKeyStore({ rootDir: process.env.SESSION_DIR || DEFAULT_SESSION_DIR });
      for (const [id, entry] of Object.entries(sessionKeysStore.load())) {
        sessionKeys.set(id, entry);
      }
    } catch (err) {
      console.warn(`Session key persistence disabled: ${err.message}. Keys survive only until restart.`);
    }
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
  const server = createServer({ traceStore, deferFinalReport: true });
  server.listen(port, host, () => {
    console.log(`PM interview prep running at http://${host}:${port}`);
    console.log(`AI provider: ${process.env.AI_PROVIDER || DEFAULT_PROVIDER} (set AI_PROVIDER to switch)`);
    console.log(`Stages: ${cfg.stages.map((s) => s.name).join(' → ')} — ${cfg.feedbackTiming} feedback`);
    if (traceStore) console.log(`Model calls traced to: ${traceStore.rootDir}`);
  });
}

module.exports = { createServer };