// Voice activity detection for the interview answer box.
//
// This is an energy gate, not a neural voice-activity model. It watches the
// RMS level of the mic stream and decides "the candidate started talking" and
// "the candidate finished talking". On its own it is happy to submit a long
// pause after a one-word answer, so every auto-submit goes through
// isSubstantiveAnswer first.
//
// Nothing in here changes what the interview pipeline does. It only decides
// when to call submitAnswer(text), which is the same call the send button
// makes. Agents, prompts and the /api/answer contract are untouched.

// Hedges, interjections and discourse markers. These add length without
// adding content, so a long answer built only from them is not an answer.
const FILLER_TOKENS = new Set([
  'um', 'uh', 'er', 'ah', 'emm', 'hmm', 'mhm', 'mm', 'erh', 'huh',
  'like', 'basically', 'literally', 'actually', 'honestly', 'obviously',
  'sort', 'kind', 'whatever', 'anyway',
  'yeah', 'yep', 'yes', 'no', 'nope', 'nah', 'okay', 'ok', 'sure', 'right',
  'so', 'well', 'now', 'then', 'and', 'but', 'or', 'i', 'you', 'we', 'they',
  'mean', 'know', 'think', 'guess', 'suppose', 'maybe',
  'just', 'really', 'very', 'quite', 'rather', 'almost', 'maybe',
  'get', 'got', 'go', 'going', 'gonna', 'wanna', 'let', 'lets',
  'thing', 'things', 'stuff', 'bit', 'lot', 'guy', 'guys',
]);

// Function words. "It was that of the thing" is fifteen words and says
// nothing, so these never count toward the content-word minimum.
const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'it', 'its', 'this', 'that', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'to', 'of', 'in', 'on', 'at', 'for', 'from', 'with', 'as', 'by',
  'there', 'here', 'he', 'she', 'him', 'her', 'his', 'hers',
  'my', 'me', 'our', 'us', 'your', 'yours', 'their', 'them',
  'do', 'does', 'did', 'done', 'have', 'has', 'had',
  'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must',
]);

const FILLER_PHRASES = [
  'yeah', 'yep', 'yes', 'no', 'nope', 'nah', 'okay', 'ok', 'sure', 'right',
  'um', 'uh', 'er', 'ah', 'hmm', 'mm', 'i guess', 'i mean', 'you know',
  "i don't know", 'no idea', 'not sure', 'whatever', 'that is all',
  "that's all", 'nothing else', 'i dont know',
];

export const DEFAULT_VAD_OPTIONS = {
  // RMS level that counts as speech. Deliberately well above room noise.
  startThreshold: 0.02,
  // Lower bar to stay "speaking". The gap between the two is hysteresis,
  // which stops the detector chattering on a decaying syllable.
  endThreshold: 0.012,
  // Level must hold above startThreshold this long before we believe speech
  // started, so a cough or a keyboard click does not open the gate.
  startMs: 180,
  // Level must stay below endThreshold this long before we call it the end.
  silenceMs: 1500,
  pollMs: 50,
};

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWords(text) {
  const normalized = normalizeText(text);
  return normalized ? normalized.split(' ').filter(Boolean).length : 0;
}

export function contentWords(text) {
  const words = normalizeText(text).split(' ').filter(Boolean);
  return words.filter((word) => !FILLER_TOKENS.has(word) && !FUNCTION_WORDS.has(word));
}

export function isFillerOnly(text) {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  if (FILLER_PHRASES.includes(normalized)) return true;
  return contentWords(normalized).length === 0;
}

export const DEFAULT_ANSWER_GUARD = {
  // Below this many words we assume the gate opened on a noise spike.
  minWords: 8,
  // Below this many non-filler words we assume it was "yeah, um, sure".
  minContentWords: 4,
  // Below this many milliseconds of speech we assume the candidate started
  // and the detector cut them off.
  minSpeechMs: 1200,
};

/**
 * Decide whether an auto-detected answer is worth submitting.
 *
 * Returns { ok: true } when the answer looks substantive, or { ok: false,
 * reason } so the caller can tell the candidate what happened instead of
 * silently re-arming forever.
 */
export function isSubstantiveAnswer(text, { speechMs = 0, ...overrides } = {}) {
  const guard = { ...DEFAULT_ANSWER_GUARD, ...overrides };
  const words = countWords(text);
  if (words < guard.minWords) {
    return { ok: false, reason: 'too_short', words, contentWords: contentWords(text).length, speechMs };
  }
  if (isFillerOnly(text)) {
    return { ok: false, reason: 'filler', words, contentWords: 0, speechMs };
  }
  if (contentWords(text).length < guard.minContentWords) {
    return { ok: false, reason: 'mostly_filler', words, contentWords: contentWords(text).length, speechMs };
  }
  if (speechMs > 0 && speechMs < guard.minSpeechMs) {
    return { ok: false, reason: 'too_brief', words, contentWords: contentWords(text).length, speechMs };
  }
  return { ok: true, words, contentWords: contentWords(text).length, speechMs };
}

function rms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const value = buf[i];
    sum += value * value;
  }
  return Math.sqrt(sum / (buf.length || 1));
}

/**
 * Watch a media stream and report speech start/end.
 *
 * The detector auto-rearms: after it reports an end it goes idle and will
 * report the next speech start. Callers should pause it while the
 * interviewer is speaking so the candidate's own playback does not open the
 * gate.
 */
export function createVad({
  onSpeechStart,
  onSpeechEnd,
  onLevel,
  options = {},
} = {}) {
  const config = { ...DEFAULT_VAD_OPTIONS, ...options };
  let context = null;
  let analyser = null;
  let source = null;
  let timer = null;
  let buffer = null;
  let state = 'idle';
  let aboveSince = 0;
  let belowSince = 0;
  let speechStartedAt = 0;
  let lastLevel = 0;
  let paused = false;

  function reset() {
    state = 'idle';
    aboveSince = 0;
    belowSince = 0;
    speechStartedAt = 0;
  }

  function tick() {
    if (!analyser || !buffer) return;
    analyser.getFloatTimeDomainData(buffer);
    const level = rms(buffer);
    lastLevel = level;
    if (onLevel) onLevel(level);

    const now = Date.now();
    if (state === 'speaking') {
      if (level >= config.endThreshold) {
        belowSince = 0;
      } else {
        if (!belowSince) belowSince = now;
        if (now - belowSince >= config.silenceMs) {
          const spokenMs = now - speechStartedAt;
          reset();
          if (onSpeechEnd && !paused) onSpeechEnd({ speechMs: spokenMs });
        }
      }
      return;
    }

    // idle: wait for a sustained level above the start threshold
    if (level >= config.startThreshold) {
      if (!aboveSince) aboveSince = now;
      if (now - aboveSince >= config.startMs) {
        state = 'speaking';
        speechStartedAt = now;
        belowSince = 0;
        aboveSince = 0;
        if (onSpeechStart && !paused) onSpeechStart({ level });
      }
    } else {
      aboveSince = 0;
    }
  }

  function attach(stream) {
    detach();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || !stream) return false;
    context = new AudioCtx();
    analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;
    buffer = new Float32Array(analyser.fftSize);
    source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    // Deliberately not connected to the destination: monitoring the mic
    // through the speakers would feed back into the recording.
    reset();
    timer = setInterval(tick, config.pollMs);
    return true;
  }

  function detach() {
    if (timer) clearInterval(timer);
    timer = null;
    if (source) {
      try { source.disconnect(); } catch (_) {}
    }
    source = null;
    analyser = null;
    buffer = null;
    if (context) {
      try { context.close(); } catch (_) {}
    }
    context = null;
    reset();
  }

  return {
    attach,
    detach,
    reset,
    setPaused(value) {
      paused = Boolean(value);
    },
    isPaused() {
      return paused;
    },
    isSpeaking() {
      return state === 'speaking';
    },
    getLevel() {
      return lastLevel;
    },
  };
}
