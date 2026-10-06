import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Send, Play, Volume2 } from 'lucide-react';
import { Button, Card, Input, Label, Seg, Select, Textarea, Progress, Badge } from '../components/ui';
import { api, cn, esc, readLocal, writeLocal, VERDICT_CLASS } from '../lib/utils';
import { Speaker, Recorder } from '../lib/speech';
import { createVad, isSubstantiveAnswer } from '../lib/vad';
import { useAuth } from '../app/authContext';
import {
  createInterviewRow,
  finishInterviewRow,
  findInterviewBySession,
  saveReport,
  saveTranscript,
  saveLiveState,
  clearLiveState,
  getLiveState,
  listTurns,
  scoreFromReport,
  countsFromReport,
  turnRowsFromTranscript,
} from '../lib/interviews';

// Used when the track list cannot be fetched, so an interview can still start.
const FALLBACK_TRACKS = [{ id: 'pm', label: 'Product Management', description: '' }];

const KIND = {
  ai: (tag, text, extra) => ({ kind: 'ai', tag, text, extra }),
  aiFu: (tag, text) => ({ kind: 'aiFu', tag, text }),
  me: (text) => ({ kind: 'me', text }),
  banner: (html) => ({ kind: 'banner', html }),
  feedback: (judge, tag) => ({ kind: 'feedback', judge, tag }),
};

// The stage an entry belongs to, as a label for the transcript. A replayed entry
// with no stage behind it falls back to a plain label.
function stageLabel(stage) {
  const name = stage && stage.name;
  if (!name) return 'question';
  return 'stage · ' + String(name).replace(/_/g, ' ');
}

export default function InterviewView({ preset, onPresetConsumed }) {
  // The signed-in candidate supplies the API keys and owns the history.
  const { user, profile, keys } = useAuth();
  const [trackId, setTrackId] = useState('pm');
  // The track list is this view's own state: the setup screen picks the track
  // and no other screen needs it, so it is fetched here rather than lifted.
  const [tracks, setTracks] = useState(FALLBACK_TRACKS);
  const [stageSel, setStageSel] = useState('');
  const [stages, setStages] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [candidateId, setCandidateId] = useState('');
  const [targetRole, setTargetRole] = useState('');
  const [resume, setResume] = useState('');
  const [voiceMode, setVoiceModeState] = useState(() => readLocal('voice-mode', 'on') !== 'off');
  const [phase, setPhase] = useState('setup'); // setup | session | analyzing | report
  const [entries, setEntries] = useState([]);
  const [progress, setProgress] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState('');
  const [report, setReport] = useState(null);
  const [micHint, setMicHint] = useState('');
  const [recording, setRecording] = useState(false);
  const [stt, setStt] = useState({ enabled: false, provider: '' });
  const [ttsProv, setTtsProv] = useState('');
  const [resumes, setResumes] = useState([]);
  const [candDetail, setCandDetail] = useState(null);
  // Voice activity detection, so an answer can be sent the moment the candidate
  // stops speaking instead of by hand.
  const [vadOn, setVadOn] = useState(() => readLocal('vad-on', 'off') !== 'off');
  const [speaking, setSpeaking] = useState(false);
  // Separate from `speaking`, which tracks the candidate. VAD must only pause
  // while the interviewer is talking, never while the candidate answers.
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [mediaHint, setMediaHint] = useState('');
  // Set once the voice and track config has loaded, so a preset is not
  // consumed before the view knows whether speech-to-text is available.
  const [ready, setReady] = useState(false);
  const presetHandledRef = useRef('');
  // The interviews row for the round on screen. The report is written back
  // against it when the round ends.
  const interviewRowRef = useRef(null);

  const ttsProvRef = useRef(ttsProv);
  ttsProvRef.current = ttsProv;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const voiceModeRef = useRef(voiceMode);
  voiceModeRef.current = voiceMode;
  const speaker = useRef(new Speaker());
  const logRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const vadRef = useRef(null);
  // speechMs of the utterance VAD last heard, handed to the answer guard.
  const speechMsRef = useRef(0);
  // True while the candidate is meant to be answering. VAD ignores the mic
  // outside this window so the interviewer's own voice cannot open the gate.
  const answerWindowRef = useRef(false);

  // Speech-to-text is Cohere for anyone who brought their own key, which the
  // server cannot know until it sees one. Saying so up front lets it report the
  // right provider, and the recorder convert Chrome's webm into a format Cohere
  // accepts instead of failing on the first answer.
  const sttQuery = useCallback(() => {
    const key = keys.stt || keys.llm;
    const session = sessionIdRef.current ? '&sessionId=' + encodeURIComponent(sessionIdRef.current) : '';
    return key ? '?provider=cohere' + session : session ? '?sessionId=' + encodeURIComponent(sessionIdRef.current) : '';
  }, [keys.stt, keys.llm]);

  const loadTracks = useCallback(async () => {
    try {
      const d = await api('GET', '/api/tracks');
      const list = (d.tracks || []).length ? d.tracks : FALLBACK_TRACKS;
      setTracks(list);
      return list;
    } catch (_) {
      setTracks(FALLBACK_TRACKS);
      return FALLBACK_TRACKS;
    }
  }, []);

  // Practice rounds share one candidate profile, so the interviewer remembers
  // earlier rounds and a debrief can be run once every stage is covered.
  const loadCandidates = useCallback(async () => {
    try {
      const d = await api('GET', '/api/candidates');
      setCandidates(d.candidates || []);
    } catch (_) {}
  }, []);

  const applyTrack = useCallback(
    async (id) => {
      setTrackId(id);
      try {
        const d = await api('GET', '/api/stages?track=' + encodeURIComponent(id));
        if (Array.isArray(d.stages)) setStages(d.stages);
      } catch (_) {}
      loadCandidates();
    },
    [loadCandidates]
  );

  useEffect(() => {
    (async () => {
      const list = await loadTracks();
      if (list.length) await applyTrack(list[0].id);
      try {
        const [ttsC, sttC, sess] = await Promise.all([
          api('GET', '/api/tts/config'),
          api('GET', '/api/transcribe/config' + sttQuery()),
          api('GET', '/api/sessions'),
        ]);
        setTtsProv(ttsC.provider || '');
        speaker.current.engine = ttsC.engine === 'server' ? 'server' : 'browser';
        setStt({ enabled: !!sttC.enabled, provider: sttC.provider || '' });
        setResumes((sess.sessions || []).filter((x) => x.awaiting === 'answer'));
      } catch (_) {}
      // Presets are handled separately, once the voice config is known.
      setReady(true);
    })();
    loadCandidates();
  }, [loadTracks, applyTrack, loadCandidates, sttQuery]);

  const speakerRef = speaker.current;

  useEffect(() => {
    speakerRef.sessionId = sessionId;
  }, [sessionId, speakerRef]);

  const append = useCallback((...items) => {
    // Only follow the transcript when the reader is already at the bottom, so
    // scrolling back to re-read an earlier answer is not undone by the next one.
    const log = logRef.current;
    const pinned = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    setEntries((prev) => [...prev, ...items]);
    if (!pinned) return;
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    });
  }, []);

  const setVoiceMode = useCallback((on) => {
    const v = !!on;
    setVoiceModeState(v);
    writeLocal('voice-mode', v ? 'on' : 'off');
    if (!v) speakerRef.stop();
  }, [speakerRef]);

  const setVoiceModeFromTTS = useCallback((d) => {
    setTtsProv(d.provider || '');
    if (d.engine === 'server') speakerRef.engine = 'server';
  }, [speakerRef]);

  useEffect(() => {
    if (voiceMode && !stt.enabled) {
      setMicHint(
        keys.stt || keys.llm
          ? 'Voice mode is on but your Cohere key did not enable speech to text. Check it in Settings, or switch to Text mode.'
          : 'Voice mode is on but there is no speech-to-text key. Add a Cohere key in Settings, or switch to Text mode.'
      );
    }
  }, [voiceMode, stt.enabled, keys.llm, keys.stt]);

  const speak = useCallback(
    async (text) => {
      if (!text) return;
      // While the interviewer talks, the answer window is closed so the VAD
      // does not record the speaker's own voice as a candidate answer.
      setTtsPlaying(true);
      try {
        await speakerRef.speak(text);
      } catch (_) {
      } finally {
        setTtsPlaying(false);
      }
    },
    [speakerRef]
  );

  const presentFinalReport = useCallback(
    (payload) => {
      setPhase('report');
      setReport(payload);
      // Writing the history is a side effect of finishing, not part of showing
      // the report: if Supabase is unreachable the candidate still gets their
      // feedback on screen, so failures are swallowed rather than surfaced over
      // the report they came to read.
      const rowId = interviewRowRef.current;
      if (!rowId || !payload) return;
      const scores = scoreFromReport(payload);
      const counts = countsFromReport(payload);
      finishInterviewRow(rowId, {
        status: 'completed',
        question_count: counts.questions,
        answer_count: counts.answers,
        overall_score: scores.overall,
        stage_scores: scores.dimensions,
        strongest_dimension: scores.strongest,
        weakest_dimension: scores.weakest,
        ended_at: new Date().toISOString(),
      })
        .then(() => saveReport(rowId, payload))
        // The round is over, so the resume pointer is meaningless. Cleared last
        // so a failure here cannot strand a finished round as "live".
        .then(() => clearLiveState(rowId))
        .catch(() => {});
    },
    []
  );

  const pollAnalysis = useCallback(async () => {
    const tick = async () => {
      try {
        const d = await api('GET', '/api/report/' + encodeURIComponent(sessionIdRef.current));
        if (d.state === 'final_report') {
          presentFinalReport(d);
          return;
        }
      } catch (err) {
        setError(err.message);
        return;
      }
      setTimeout(tick, 2500);
    };
    tick();
  }, [presentFinalReport]);

  // Every payload the engine sends carries the transcript so far, so the round
  // is written to the database as it happens rather than only when it ends. If
  // the tab or the server dies mid-interview, the history still shows the
  // questions, answers and analysis that were already produced.
  //
  // Best effort, like the report write: a database failure must not interrupt an
  // interview the candidate is in the middle of answering.
  const persistRound = useCallback(
    (payload) => {
      const rowId = interviewRowRef.current;
      if (!rowId || !payload || !user) return;
      saveTranscript(rowId, payload.transcript)
        .then(() =>
          saveLiveState(rowId, {
            sessionId: payload.sessionId,
            stage: payload.stage && payload.stage.name,
            stageIndex: payload.stage && payload.stage.index,
            pendingQuestion: payload.question ? payload.question.text : '',
            pendingFollowUp: Boolean(payload.question && payload.question.isFollowUp),
            stageProgress: payload.stageProgress || {},
            turnsWritten: turnRowsFromTranscript(payload.transcript).length,
          })
        )
        .catch(() => {});
    },
    [user]
  );

  const presentReply = useCallback(
    (payload) => {
      setError('');
      persistRound(payload);
      if (payload.state === 'question' || payload.state === 'follow_up') {
        const isFu = payload.state === 'follow_up' || (payload.question && payload.question.isFollowUp);
        if (payload.feedback) append(KIND.feedback(payload.feedback, 'Judge feedback'));
        const q = payload.question;
        append(isFu ? KIND.aiFu('follow-up', '#' + q.text) : KIND.ai(stageLabel(payload.stage), '#' + q.text));
        setProgress(payload);
        setPhase('session');
      } else if (payload.state === 'clarify_reply') {
        setProgress(payload);
        append(KIND.aiFu('interviewer · clarification', payload.clarifyAnswer));
        append(KIND.banner(payload.wrapUp ? `The interviewer would like your answer now — go ahead and answer <b>${esc(payload.question.text)}</b>` : `Clarifying question noted — now answer <b>${esc(payload.question.text)}</b>`));
        setPhase('session');
      } else if (payload.state === 'transition') {
        const t = payload.transition;
        let html = `<b>Stage complete: ${esc(t.from)}.</b> Moving on to <b>${esc(t.to)}</b>.`;
        if (t.stageVerdict) html += `<br>${esc(t.stageVerdict.summary || '')}`;
        append(KIND.banner(html));
        setTimeout(() => {
          setProgress(payload);
          append(KIND.ai(stageLabel(payload.stage), '#' + payload.question.text));
        }, 350);
      } else if (payload.state === 'analyzing') {
        setProgress(payload);
        append(KIND.banner('Interview ended — we are analyzing your interview to give you insights. This may take a few minutes.'));
        setPhase('analyzing');
        pollAnalysis();
      } else if (payload.state === 'final_report') {
        presentFinalReport(payload);
      }
    },
    [append, pollAnalysis, presentFinalReport, persistRound]
  );

  const askQuestion = useCallback(
    (payload) => {
      setProgress(payload);
      setPhase('session');
      const q = payload.question;
      const isFu = payload.state === 'follow_up' || (q && q.isFollowUp);
      append(isFu ? KIND.aiFu('follow-up', '#' + q.text) : KIND.ai(stageLabel(payload.stage), '#' + q.text));
    },
    [append]
  );

  // The transcript, stored as rows in the database, back into the on-screen
  // entries. This is the same replay the engine's own transcript used to drive,
  // except it reads from `interview_turns`, so a round reopens with its history
  // intact even when the engine no longer holds the session.
  const entriesFromTurns = useCallback((turns, revealJudges) => {
    const out = [];
    for (const t of turns) {
      // Judged turns are stored from the first answer onwards, but they stay
      // hidden until the round ends. Reopening a live round must not leak them.
      if (t.kind === 'judge' && !revealJudges) continue;
      if (t.kind === 'question') {
        out.push(t.is_follow_up ? KIND.aiFu('follow-up', '#' + t.text) : KIND.ai(stageLabel({ name: t.stage }), '#' + t.text));
      } else if (t.kind === 'answer') {
        out.push(KIND.me(t.text));
      } else if (t.kind === 'clarify') {
        const d = t.detail || {};
        out.push(KIND.me(d.candidate_question || ''));
        out.push(KIND.aiFu('interviewer · clarification', d.interviewer_answer || ''));
      } else if (t.kind === 'judge') {
        const d = t.detail || {};
        out.push(KIND.feedback({ verdict: d.verdict, summary: d.summary, dimension_scores: d.dimension_scores, checklist_hits: d.checklist_hits, green_flags_hit: d.green_flags_hit, red_flags_hit: d.red_flags_hit }, 'Judge · ' + t.stage));
      } else if (t.kind === 'stage_verdict') {
        const v = (t.detail && t.detail.verdict) || {};
        out.push(KIND.banner(`<b>Stage complete: ${esc(t.stage)}.</b> ${verdictHtml(v.stage_verdict)}<br>${esc(v.summary || '')}`));
      }
    }
    return out;
  }, []);

  const startFlow = useCallback(
    (payload, fromResume) => {
      const ref = payload.sessionId;
      setSessionId(ref);
      setCandidateId((payload.candidate && payload.candidate.id) || null);
      setEntries([]);
      setReport(null);
      if (fromResume && Array.isArray(payload.transcript)) {
        // A round reopens with its questions and answers intact and the judge
        // still withheld, because the round has not ended yet.
        const reveal = payload.state === 'final_report';
        setEntries(entriesFromTurns(turnRowsFromTranscript(payload.transcript), reveal));
      }
      // Persist on open too, so a round the engine resumed also refreshes the
      // rows the browser is about to render.
      persistRound(payload);
      askQuestion(payload);
      setPhase('session');
    },
    [askQuestion, entriesFromTurns, persistRound]
  );

  const submitAnswer = useCallback(
    async (text) => {
      if (!text || busy || !sessionIdRef.current) return;
      append(KIND.me(text));
      setBusy(true);
      try {
        const d = await api('POST', '/api/answer', {
          sessionId: sessionIdRef.current,
          answer: text,
        });
        presentReply(d);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [append, busy, presentReply]
  );

  const send = useCallback(() => {
    const text = answer.replace(/\s+$/g, '\n').trim();
    if (!text || busy || !sessionId) return;
    setAnswer('');
    submitAnswer(text);
  }, [answer, busy, sessionId, submitAnswer]);

  const recorder = useRef(null);
  if (!recorder.current) {
    recorder.current = new Recorder({
      // onTranscribed is attached below, once submitAnswer exists.
      onHint: (msg) => setMicHint(msg),
    });
  }
  recorder.current.sttProvider = stt.provider;

  // The transcript decision lives here, not in the recorder, so one place owns
  // the "is this answer worth submitting" rule and the text-mode fallback.
  const onTranscribed = useCallback(
    (text, meta) => {
      const speechMs = (meta && meta.speechMs) || 0;
      const verdict = isSubstantiveAnswer(text, { speechMs });
      if (!verdict.ok) {
        const message =
          verdict.reason === 'filler' || verdict.reason === 'mostly_filler'
            ? 'That sounded like filler — still listening.'
            : verdict.reason === 'too_brief'
              ? 'That answer was very short — still listening.'
              : 'I did not catch a full answer — still listening.';
        setMicHint(message);
        setTimeout(() => setMicHint(''), 2600);
        return;
      }
      // The transcript lands in the answer box, never submitted on its own.
      setAnswer((cur) => {
        const base = cur.replace(/\s+$/g, '').trimEnd();
        return base ? base + '\n' + text : text;
      });
    },
    []
  );

  // The recorder is created once and outlives this callback, so the transcript
  // handler is refreshed on every render instead of being captured at mount.
  recorder.current.onTranscribed = onTranscribed;

  const toggleMic = useCallback(() => {
    recorder.current.toggle({
      busy,
      sttEnabled: stt.enabled,
      sessionId: sessionIdRef.current,
      speechMs: speechMsRef.current,
      setRecording,
    });
  }, [busy, stt.enabled]);

  const stopMedia = useCallback(() => {
    if (vadRef.current) {
      vadRef.current.detach();
      vadRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    recorder.current.setSharedStream(null);
    setSpeaking(false);
    setMicLevel(0);
  }, []);

  // One permission prompt for the whole session. The same stream feeds the
  // voice activity detector and the answer recorder.
  const startMedia = useCallback(
    async () => {
      if (!navigator.mediaDevices) {
        setMediaHint('This browser cannot record audio.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        recorder.current.setSharedStream(stream);

        if (vadOn && stt.enabled) {
          const vad = createVad({
            onLevel: (level) => setMicLevel(Math.min(1, level * 8)),
            onSpeechStart: () => {
              setSpeaking(true);
              // Open the answer clip as soon as the candidate starts talking,
              // otherwise the clip is created after the audio we need.
              if (!recorder.current.recording) {
                recorder.current.toggle({
                  busy,
                  sttEnabled: stt.enabled,
                  sessionId: sessionIdRef.current,
                  speechMs: speechMsRef.current,
                  setRecording,
                });
              }
            },
            onSpeechEnd: ({ speechMs }) => {
              setSpeaking(false);
              speechMsRef.current = speechMs;
              // Silence means the candidate finished. Close the answer clip and
              // let the transcript decide whether to submit it.
              if (recorder.current.recording) recorder.current.stop();
            },
          });
          if (vad.attach(stream)) vadRef.current = vad;
        }
        setMediaHint('');
      } catch (err) {
        const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        setMediaHint(
          denied
            ? 'Microphone access was denied — you can still answer by tapping the mic.'
            : 'Could not start the microphone.'
        );
        stopMedia();
      }
    },
    [vadOn, stt.enabled, stopMedia]
  );

  // Declared after startMedia so its dependency array never reads it before
  // initialization.
  const start = useCallback(async (overrides = {}) => {
    setError('');
    setBusy(true);
    // The profile is the source of truth for who is interviewing and for what.
    // The setup wizard does not ask again, so the fields this view still holds
    // start empty and fall back to the profile.
    //
    // Overrides exist for the preset auto-start: that path calls `start` in the
    // same tick as setStageSel, so the state this closure captured is still the
    // previous render's. Reading stageSel there would send an empty stage.
    const body = {
      mode: 'mock',
      stage: overrides.stage || stageSel,
      track: overrides.track || trackId,
      targetRole: (targetRole.trim() || profile?.target_role || '').trim(),
      resume: (resume.trim() || profile?.resume_text || '').trim(),
    };
    if (candidateId) body.candidateId = candidateId;
    if (user) {
      // Sent so the server can record who this round belongs to. The server
      // takes the owner from the access token instead and ignores this one.
      body.userId = user.id;
      body.apiKey = keys.llm || '';
      body.sttApiKey = keys.stt || keys.llm || '';
    }
    try {
      const d = await api('POST', '/api/start', body);
      startFlow(d);
      startMedia();
      // Recorded after the engine has accepted the run, so the history never
      // claims an interview that never started. A failure here costs the history
      // entry, not the interview, so it is reported and not thrown.
      if (user) {
        createInterviewRow({
          sessionId: d.sessionId,
          mode: 'mock',
          // The server response is the source of truth: the preset auto-start
          // path reaches here before stageSel's state update has rendered.
          stage: (d.stage && d.stage.name) || overrides.stage || stageSel,
          voiceMode: voiceModeRef.current,
          targetRole: body.targetRole,
        })
          .then((row) => {
            interviewRowRef.current = row ? row.id : null;
            // The opening question arrived before this row existed, so the first
            // turn has to be written once the history row is in hand.
            if (row) persistRound(d);
          })
          .catch((err) => setError('Interview started, but it could not be added to your history: ' + err.message));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [
    stageSel, trackId, candidateId, targetRole, resume,
    profile, user, keys.llm, keys.stt, startFlow, startMedia,
  ]);

  const resumeSession = useCallback(
    async (id) => {
      if (!id) return;
      setError('');
      setBusy(true);
      try {
        const d = await api('GET', '/api/sessions/' + encodeURIComponent(id));
        startFlow(d, true);
        startMedia();
        // Rejoining a round that is already in the history, so its report is
        // written back to the existing row.
        const row = await findInterviewBySession(id);
        interviewRowRef.current = row ? row.id : null;
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [startFlow, startMedia]
  );

  // Handing a preset over from another view. It waits for `ready` so the voice
  // config is already loaded, and it lives down here because its dependency
  // array reads startFlow and startMedia.
  useEffect(() => {
    if (!preset || !ready) return;
    // A preset can survive a re-render, so consume each one exactly once.
    const key =
      preset.sessionId ||
      [preset.trackId, preset.stage, preset.candidateId, preset.autoStart, preset.run].join('|');
    if (presetHandledRef.current === key) return;
    presetHandledRef.current = key;
    (async () => {
      if (preset.trackId) await applyTrack(preset.trackId);
      if (preset.stage) setStageSel(preset.stage);
      if (preset.candidateId) setCandidateId(preset.candidateId);
      if (preset.targetRole != null) setTargetRole(preset.targetRole);
      if (preset.resume != null) setResume(preset.resume);
      if (preset.voiceMode != null) setVoiceMode(preset.voiceMode);
      if (onPresetConsumed) onPresetConsumed();
      // A round the server already started, linked from the dashboard or the
      // history, is rejoined by id instead of creating a second session.
      if (preset.sessionId) {
        try {
          const d = await api('GET', '/api/sessions/' + encodeURIComponent(preset.sessionId));
          startFlow(d, true);
          startMedia();
          const row = await findInterviewBySession(preset.sessionId);
          interviewRowRef.current = row ? row.id : null;
        } catch (err) {
          setError(err.message);
        }
        return;
      }
      // The practice setup wizard collects every option before navigating here,
      // so it can hand over a finished configuration and start immediately
      // rather than showing the same form a second time.
      if (preset.autoStart || preset.run) await start({ stage: preset.stage, track: preset.trackId });
    })();
  }, [preset, ready, applyTrack, startFlow, startMedia, onPresetConsumed, setVoiceMode, start]);

  // Open the answer window only when it is the candidate's turn, and close it
  // while the interviewer is speaking.
  useEffect(() => {
    const open = phase === 'session' && !busy && !ttsPlaying;
    answerWindowRef.current = open;
    if (vadRef.current) vadRef.current.setPaused(!open);
  }, [phase, busy, ttsPlaying]);

  useEffect(() => () => stopMedia(), [stopMedia]);

  const toggleVad = useCallback(() => {
    const next = !vadOn;
    setVadOn(next);
    writeLocal('vad-on', next ? 'on' : 'off');
  }, [vadOn]);

  const runDebrief = useCallback(
    async (id) => {
      setBusy(true);
      try {
        await api('POST', '/api/debrief', { candidateId: id });
        await loadCandidates();
        const d = await api('GET', '/api/candidates/' + encodeURIComponent(id));
        setCandDetail(d.candidate);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [loadCandidates]
  );

  const trackLabel = useMemo(() => {
    const map = {};
    for (const t of tracks) map[t.id] = t.label;
    return (id) => map[id] || id || 'pm';
  }, [tracks]);

  const activeCandidate = candidates.find((c) => c.id === candidateId) || null;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {phase === 'setup' && (
        <Card className="p-6">
          <div className="mb-4 space-y-2">
            <div className="text-lg font-semibold">Set up your interview</div>
            <Label className="text-xs text-muted-foreground">Track</Label>
            <Select value={trackId} onChange={(e) => applyTrack(e.target.value)} className="max-w-md">
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{tracks.find((t) => t.id === trackId)?.description || ''}</p>
          </div>

          <p className="mb-4 text-xs text-muted-foreground">
            One stage per round. The candidate profile carries across rounds, and a final debrief runs once
            every gradeable stage is covered.
          </p>

          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Candidate</Label>
              <Select value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
                <option value="">New candidate</option>
                {candidates
                  .filter((c) => !c.trackId || c.trackId === trackId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {(c.targetRoleAndLevel || 'candidate').slice(0, 26)} · {c.coveredStages.length}/{c.total} stages
                      {c.hasDebrief ? ' · debrief done' : ''} · {new Date(c.updatedAt).toLocaleDateString()}
                    </option>
                  ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Stage</Label>
              <Select value={stageSel} onChange={(e) => setStageSel(e.target.value)}>
                {stages
                  .filter((s) => s.name !== 'greeting')
                  .map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name.replace(/_/g, ' ')}
                    </option>
                  ))}
              </Select>
            </div>
          </div>

          {!activeCandidate ? (
            <>
              <div className="mb-3 space-y-1">
                <Label>Target role / level (optional)</Label>
                <Input value={targetRole} onChange={(e) => setTargetRole(e.target.value)} placeholder="e.g. Senior PM, B2B SaaS" />
              </div>
              <div className="mb-3 space-y-1">
                <Label>Paste your resume / background (optional)</Label>
                <Textarea
                  value={resume}
                  onChange={(e) => setResume(e.target.value)}
                  rows={5}
                  placeholder="Paste your resume, LinkedIn summary, or background so the interviewer's profile agent has more context about you. Applied when you create a candidate."
                />
                <p className="text-xs text-muted-foreground">Kept to the first 8,000 characters.</p>
              </div>
            </>
          ) : (
            <div className="mb-3 rounded-md border p-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">Stages covered: {activeCandidate.coveredStages.length}/{activeCandidate.total}</Badge>
                {activeCandidate.roundsPlayed ? <Badge variant="outline">Rounds: {activeCandidate.roundsPlayed}</Badge> : null}
                <Badge variant={activeCandidate.done ? 'good' : 'secondary'}>
                  {activeCandidate.done ? 'All gradeable stages covered' : 'Next up: ' + (activeCandidate.missing?.[0] || '—')}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                This round continues the candidate's profile — the interviewer sees notes from earlier rounds.
              </p>
              <div className="mt-2 flex gap-2">
                {activeCandidate.hasDebrief ? (
                  <Button variant="secondary" size="sm" onClick={() => setCandDetail(activeCandidate)}>
                    View candidate debrief
                  </Button>
                ) : null}
                <Button size="sm" onClick={() => runDebrief(candidateId)} disabled={busy}>
                  {activeCandidate.hasDebrief ? 'Update debrief' : 'Run candidate debrief'}
                </Button>
              </div>
              {candDetail ? (
                <div className="mt-3 space-y-2 text-sm">
                  {candDetail.debriefReport?.report ? (
                    <>
                      <div className="text-sm font-semibold">
                        Debrief — <span className={VERDICT_CLASS[candDetail.debriefReport.report.overall_verdict] || ''}>{candDetail.debriefReport.report.overall_verdict}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">Generated {new Date(candDetail.debriefReport.at).toLocaleString()}</div>
                      <p>{candDetail.debriefReport.report.summary}</p>
                      {candDetail.debriefReport.report.cross_stage_patterns?.length ? (
                        <ul className="list-inside list-disc text-sm">{candDetail.debriefReport.report.cross_stage_patterns.map((p, i) => <li key={i}>{p}</li>)}</ul>
                      ) : null}
                      {candDetail.debriefReport.report.top_things_to_work_on?.length ? (
                        <ul className="list-inside list-disc text-sm">{candDetail.debriefReport.report.top_things_to_work_on.map((p, i) => <li key={i}>{p}</li>)}</ul>
                      ) : null}
                    </>
                  ) : <p className="text-xs text-muted-foreground">No debrief yet for this candidate.</p>}
                </div>
              ) : null}
            </div>
          )}

          <div className="mb-4 space-y-1">
            <Label>Voice mode</Label>
            <Seg
              value={voiceMode ? 'on' : 'off'}
              onChange={(v) => setVoiceMode(v === 'on')}
              options={[
                { value: 'off', label: 'Text' },
                { value: 'on', label: 'Voice' },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              {voiceMode ? 'You answer with the microphone. Tap Listen on a question to hear it; your words land in the box and you send them yourself.' : 'Type your answers. Tap Listen on a question to hear it aloud.'}
            </p>
          </div>

          <Button onClick={start} disabled={busy}>
            Start interview
          </Button>

          {resumes.length ? (
            <div className="mt-5 border-t pt-4">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <div className="space-y-1">
                  <Label>Resume an interrupted session</Label>
                  <Select onChange={(e) => resumeSession(e.target.value)}>
                    <option value="">— pick a session —</option>
                    {resumes.map((s) => (
                      <option key={s.sessionId} value={s.sessionId}>
                        {s.practiceStage || 'greeting'} · {s.answers} answers · {new Date(s.startedAt).toLocaleString()} · {trackLabel(s.track)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button variant="secondary" onClick={(e) => resumeSession(e.target.form ? e.target.form.querySelector('select').value : '')}>
                    Resume
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </Card>
      )}

      {phase === 'session' || phase === 'analyzing' ? (
        <div className="space-y-5">
          {/* The film puts the stage on the left and the count on the right, both
              in mono, with nothing between them and the question. */}
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="kicker">
                {progress?.stage ? progress.stage.name.replace(/_/g, ' ') : 'Getting ready'}
              </span>
              <span className="kicker">
                {progress?.stage
                  ? 'Question ' +
                    Math.min(
                      (progress.stageProgress?.questionsAsked ?? 0) + 1,
                      Math.max(1, progress.stageProgress?.minQuestions ?? 1)
                    ) +
                    ' of ' +
                    (progress.stageProgress?.minQuestions ?? 0)
                  : ''}
              </span>
            </div>
            {progress?.stage ? (
              <div className="mt-3">
                <Progress index={progress.stage.index} total={progress.stage.total} />
              </div>
            ) : null}
            <p className="mt-2 text-[13px] text-mute">
              {progress?.mode ? 'mode: ' + progress.mode : ''}
              {progress?.candidate?.id ? ' · candidate: ' + progress.candidate.id.slice(0, 6) : ''}
              {sessionId ? ' · ' + sessionId.slice(0, 8) : ''}
              {progress?.stage ? ' · follow-ups used ' + (progress.stageProgress?.followUpsUsed ?? 0) : ''}
            </p>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
            <div className="space-y-3">
              <div className="inset min-h-[120px] px-8 py-7">
                <div ref={logRef} className="max-h-[46vh] space-y-5 overflow-y-auto pr-1">
                  {entries.map((e, i) => <Entry key={i} item={e} onSpeak={speak} />)}
                  {!entries.length ? <p className="text-[19px] text-mute">Session starting…</p> : null}
                </div>
              </div>

              {phase === 'analyzing' ? (
                <div className="inset px-8 py-10 text-center">
                  <Play className="animate-pulse-soft mx-auto h-6 w-6 text-mute" />
                  <p className="mx-auto mt-3 max-w-[520px] text-[19px] text-mute">Interview ended — we are analyzing your interview to give you insights. This may take a few minutes.</p>
                </div>
              ) : (
                <div className="inset px-7 py-6">
                  {micHint && <p className="mb-3 text-[15px] text-developing">{micHint}</p>}
                  {mediaHint && <p className="mb-3 text-[15px] text-destructive">{mediaHint}</p>}
                  <div className="flex items-end gap-4">
                    <Button
                      onClick={toggleMic}
                      disabled={busy || !stt.enabled}
                      variant="secondary"
                      aria-pressed={recording}
                      className={cn(
                        'mono h-[46px] shrink-0 rounded-full border px-[22px]',
                        recording
                          ? 'animate-pulse-soft border-destructive bg-destructive/10 text-destructive'
                          : 'border-line bg-card text-mute hover:text-ink'
                      )}
                      title={stt.enabled ? 'Speak your answer instead of typing it' : 'Voice input is off — add a Cohere key in Settings'}
                    >
                      <Mic className="h-4 w-4" /> {recording ? 'Stop' : 'Voice'}
                    </Button>
                    <Textarea
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      className="min-h-[120px] flex-1 border-0 bg-transparent px-0 py-0 text-[21px] leading-relaxed focus-visible:border-0"
                      rows={2}
                      placeholder={
                        voiceMode ? 'Your words land here — review, then press Send' : 'Type your answer here… Enter to send'
                      }
                      disabled={busy}
                    />
                    <Button
                      onClick={send}
                      disabled={busy || !answer.trim()}
                      aria-label="Send answer"
                      className="h-12 w-12 shrink-0 rounded-full p-0"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                  {voiceMode ? (
                    <p className="mt-4 text-[15px] text-mute">
                      Tap the microphone, speak, then tap Stop. Your transcript appears above — review, edit, then press Send.
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            <div className="space-y-3">
              {voiceMode && stt.enabled ? (
                <div className="inset px-6 py-5">
                  <div className="flex items-center justify-between">
                    <span className="mono text-[16px] text-mute">
                      {speaking ? 'Listening' : vadOn ? 'Waiting' : 'Manual'}
                    </span>
                    <button
                      type="button"
                      onClick={toggleVad}
                      className="mono rounded-full border border-line px-4 py-2 text-[14px] text-mute transition-colors hover:border-ink hover:text-ink"
                      title={vadOn ? 'Stop transcribing when you pause speaking' : 'Transcribe only when you tap Stop'}
                    >
                      {vadOn ? 'Auto-stop' : 'Manual'}
                    </button>
                  </div>
                  <div className="mt-4 h-4 w-full overflow-hidden rounded-full bg-line">
                    <div
                      className={cn('h-full rounded-full transition-all', speaking ? 'bg-good' : 'bg-ink/25')}
                      style={{ width: `${Math.max(3, Math.round(micLevel * 100))}%` }}
                    />
                  </div>
                  <p className="mono mt-3 text-[14px] text-mute">
                    {speaking ? 'Listening to your answer…' : vadOn ? 'Pause speaking to finish transcribing' : 'Tap Stop to finish transcribing'}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {phase === 'report' && report ? <ReportView report={report} /> : null}
    </div>
  );
}

function verdictHtml(v) {
  return `<span class="font-semibold ${VERDICT_CLASS[v] || 'text-muted-foreground'}">${esc(v || '—')}</span>`;
}

function Entry({ item, onSpeak }) {
  if (item.kind === 'me') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-[14px] bg-ink px-6 py-4 text-[19px] leading-relaxed text-paper dark:bg-ink dark:text-ground">{item.text}</div>
      </div>
    );
  }
  if (item.kind === 'ai' || item.kind === 'aiFu') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%]">
          {item.tag ? <div className="kicker mb-2">{item.tag}</div> : null}
          <div
            className={cn(
              'display text-[26px] leading-snug',
              item.kind === 'aiFu' && 'text-mute'
            )}
          >
            {item.text}
          </div>
          {onSpeak ? (
            <button
              type="button"
              onClick={() => onSpeak(item.text)}
              className="mono mt-2 inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[13px] text-mute transition-colors hover:border-ink hover:text-ink"
              aria-label="Read this aloud"
            >
              <Volume2 className="h-3.5 w-3.5" /> Listen
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  if (item.kind === 'banner') {
    return <div className="inset px-6 py-4 text-[17px]" dangerouslySetInnerHTML={{ __html: item.html }} />;
  }
  if (item.kind === 'feedback' && item.judge) {
    return <FeedbackBlock judge={item.judge} tag={item.tag} />;
  }
  return null;
}

function FeedbackBlock({ judge, tag }) {
  const dims = judge.dimension_scores;
  const checklist = judge.checklist_hits;
  return (
    <div className="inset px-7 py-6 text-[18px]">
      <div className="kicker mb-3">{tag || 'Judge feedback'}</div>
      {judge.overall_verdict ? (
        <div className={cn('display text-[30px] leading-tight', VERDICT_CLASS[judge.overall_verdict] || '')}>
          {judge.overall_verdict}
        </div>
      ) : null}
      {judge.summary ? <p className="mt-3 text-mute">{judge.summary}</p> : null}
      {(dims || checklist) && (
        <dl className="mt-5 grid grid-cols-2 gap-x-10 gap-y-1 text-[15px]">
          {dims ? Object.entries(dims).map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-line">
              <dt className="text-mute">{k}</dt>
              <dd className="mono">{v}/5</dd>
            </div>
          )) : null}
          {checklist ? (
            <div className="flex justify-between border-b border-line">
              <dt className="text-mute">process steps hit</dt>
              <dd className="mono">
                {Object.values(checklist).filter(Boolean).length}/{Object.keys(checklist).length}
              </dd>
            </div>
          ) : null}
        </dl>
      )}
      {judge.green_flags_hit?.length ? (
        <ul className="mt-4 list-inside list-disc space-y-1 text-[17px] text-good">{judge.green_flags_hit.map((g, i) => <li key={i}>{g}</li>)}</ul>
      ) : null}
      {judge.red_flags_hit?.length ? (
        <ul className="mt-4 list-inside list-disc space-y-1 text-[17px] text-weak">{judge.red_flags_hit.map((r, i) => <li key={i}>{r}</li>)}</ul>
      ) : null}
    </div>
  );
}

function orderCoachPlan(plan, priority) {
  const byGap = new Map();
  for (const item of plan || []) if (item && item.gap) byGap.set(item.gap, item);
  const ordered = [];
  for (const key of priority || []) if (byGap.has(key)) { ordered.push(byGap.get(key)); byGap.delete(key); }
  for (const item of byGap.values()) ordered.push(item);
  return ordered;
}

function ReportView({ report }) {
  const r = report.report;
  const isMock = r && r.report;
  if (isMock) {
    return <MockReport report={r.report} stageVerdicts={r.stageVerdicts} actionPlan={r.action_plan} priorityOrder={r.priority_order} />;
  }
  return <RoundReport r={r} cand={report.candidate} debrief={report.debrief} />;
}

function CoachPlan({ actionPlan, priorityOrder }) {
  const items = orderCoachPlan(actionPlan, priorityOrder);
  if (!items.length) return null;
  return (
    <>
      <h3 className="display mt-10 text-[26px] leading-tight">How to improve</h3>
      <div className="inset mt-4 divide-y divide-line px-7">
        {items.map((item, i) => (
          <div key={i} className="flex gap-6 py-5">
            <span className="display w-8 shrink-0 text-[30px] leading-none text-mute">{i + 1}</span>
            <div className="min-w-0 space-y-2 text-[18px]">
              <div className="display text-[24px] leading-tight">{item.gap}</div>
              {item.resource ? <div className="mono text-[14px] text-mute">{item.resource}</div> : null}
              {item.why_it_matters ? <div><span className="kicker">Why it matters</span><p className="mt-1">{item.why_it_matters}</p></div> : null}
              {item.how_to_practice ? <div><span className="kicker">Practice drill</span><p className="mt-1">{item.how_to_practice}</p></div> : null}
              {item.try_this_next_time ? <div><span className="kicker">Next time</span><p className="mt-1 text-mute">{item.try_this_next_time}</p></div> : null}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function StageVerdictList({ stageVerdicts }) {
  return (
    <div className="mt-10 space-y-4">
      <h3 className="display text-[26px] leading-tight">Per-stage results</h3>
      {(stageVerdicts || []).map((sv, i) => (
        <div key={i} className="inset px-7 py-6">
          <div className="flex items-center justify-between gap-3">
            <span className="display text-[24px] leading-tight">{esc(sv.stage)}</span>
            <Badge variant={sv.verdict.stage_verdict === 'strong' ? 'good' : sv.verdict.stage_verdict === 'developing' ? 'developing' : sv.verdict.stage_verdict === 'weak' ? 'weak' : 'secondary'}>
              {sv.verdict.stage_verdict}
            </Badge>
          </div>
          <p className="mt-3 text-[18px] text-mute">{sv.verdict.summary || ''}</p>
          {sv.verdict.strengths?.length ? <p className="mt-2 text-[17px] text-good">Strengths: {sv.verdict.strengths.join(', ')}</p> : null}
          {sv.verdict.gaps?.length ? <p className="mt-2 text-[17px] text-weak">Gaps: {sv.verdict.gaps.join(', ')}</p> : null}
        </div>
      ))}
    </div>
  );
}

function MockReport({ report, stageVerdicts, actionPlan, priorityOrder }) {
  const resources = report.recommended_resources || [];
  return (
    <div className="inset px-9 py-9">
      <div className="kicker">Overall</div>
      <div className={cn('display mt-3 text-[76px] leading-[0.95] md:text-[96px]', VERDICT_CLASS[report.overall_verdict] || '')}>
        {report.overall_verdict || '—'}
      </div>
      <p className="mt-6 max-w-[700px] text-[21px] leading-relaxed text-mute">{report.summary || ''}</p>
      <h3 className="display mt-10 text-[26px] leading-tight">Patterns across stages</h3>
      <ul className="mt-3 list-inside list-disc space-y-2 text-[19px]">{report.cross_stage_patterns?.map((p, i) => <li key={i}>{p}</li>)}</ul>
      <h3 className="display mt-8 text-[26px] leading-tight">Top things to work on</h3>
      <ul className="mt-3 list-inside list-disc space-y-2 text-[19px]">{report.top_things_to_work_on?.map((p, i) => <li key={i}>{p}</li>)}</ul>
      <CoachPlan actionPlan={actionPlan} priorityOrder={priorityOrder} />
      {resources.length ? (
        <>
          <h3 className="display mt-10 text-[26px] leading-tight">Recommended resources</h3>
          <ul className="mt-3 list-inside list-disc space-y-2 text-[19px] text-mute">
            {resources.map((r, i) => (
              <li key={i}>
                <b className="text-ink">{r.title || ''}</b>
                {r.type ? <span> ({r.type})</span> : null}
                {r.why ? <span> — {r.why}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <StageVerdictList stageVerdicts={stageVerdicts} />
    </div>
  );
}

function RoundReport({ r, cand, debrief }) {
  const sv = (r?.stageVerdicts || [])[0];
  const plan = r?.action_plan && r.action_plan.length ? <CoachPlan actionPlan={r.action_plan} priorityOrder={r.priority_order} /> : '';
  return (
    <div className="inset px-9 py-9">
      <div className="kicker">Round complete</div>
      {sv ? (
        <>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="display text-[30px] leading-tight">{esc(sv.stage)}</span>
            <Badge variant={sv.verdict.stage_verdict === 'strong' ? 'good' : sv.verdict.stage_verdict === 'developing' ? 'developing' : sv.verdict.stage_verdict === 'weak' ? 'weak' : 'secondary'}>
              {sv.verdict.stage_verdict}
            </Badge>
          </div>
          <p className="mt-3 text-[19px]">{sv.verdict.summary || ''}</p>
          {sv.verdict.strengths?.length ? <h3 className="display mt-8 text-[26px] leading-tight">Strengths</h3> : null}
          {sv.verdict.strengths?.length ? <ul className="mt-3 list-inside list-disc space-y-2 text-[19px]">{sv.verdict.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul> : null}
          {sv.verdict.gaps?.length ? <h3 className="display mt-8 text-[26px] leading-tight">Gaps</h3> : null}
          {sv.verdict.gaps?.length ? <ul className="mt-3 list-inside list-disc space-y-2 text-[19px]">{sv.verdict.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul> : null}
          {plan}
        </>
      ) : (
        <p className="mt-3 text-[19px] text-mute">This stage was not graded.</p>
      )}
      {cand ? (
        <div className="mt-10 border-t border-line pt-6">
          <h3 className="display text-[26px] leading-tight">Rounds progress</h3>
          <p className="mono mt-3 text-[17px] text-mute">Stages covered: <b className="text-ink">{cand.coveredStages.length}/{cand.total}</b></p>
          {!cand.done && cand.missing?.length ? <ul className="mt-3 list-inside list-disc text-[18px]">{cand.missing.map((m, i) => <li key={i}>{m}</li>)}</ul> : null}
          <p className="mt-3 text-[18px] text-mute">
            {cand.done ? 'All gradeable stages are covered — the candidate debrief is below.' : 'Start another round to keep building this candidate.'}
          </p>
        </div>
      ) : null}
      {debrief?.report ? <DebriefBlock debrief={debrief} /> : null}
      <Button size="lg" className="mt-10 w-[238px]" onClick={() => location.reload()}>Start next round</Button>
    </div>
  );
}

function DebriefBlock({ debrief }) {
  const report = debrief.report;
  const recs = report.recommended_resources || [];
  return (
    <div className="mt-10 border-t border-line pt-8">
      <h3 className="kicker">Candidate debrief</h3>
      <div className={cn('display mt-3 text-[56px] leading-none', VERDICT_CLASS[report.overall_verdict] || '')}>{report.overall_verdict}</div>
      <p className="mt-4 max-w-[700px] text-[19px] text-mute">{report.summary}</p>
      <h3 className="display mt-8 text-[26px] leading-tight">Patterns across stages</h3>
      <ul className="mt-3 list-inside list-disc space-y-2 text-[19px]">{report.cross_stage_patterns?.map((p, i) => <li key={i}>{p}</li>)}</ul>
      <h3 className="display mt-8 text-[26px] leading-tight">Top things to work on</h3>
      <ul className="mt-3 list-inside list-disc space-y-2 text-[19px]">{report.top_things_to_work_on?.map((p, i) => <li key={i}>{p}</li>)}</ul>
      {recs.length ? (
        <ul className="mt-6 list-inside list-disc space-y-2 text-[18px] text-mute">
          {recs.map((rr, i) => (
            <li key={i}><b className="text-ink">{rr.title || ''}</b>{rr.type ? <span> ({rr.type})</span> : null}{rr.why ? <span> — {rr.why}</span> : null}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2"><CoachPlan actionPlan={debrief.action_plan} priorityOrder={debrief.priority_order} /></div>
    </div>
  );
}