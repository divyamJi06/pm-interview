export class Speaker {
  constructor() {
    this.el = null;
    this.src = null;
    this.engine = 'browser';
    this.sessionId = null;
  }

  stop() {
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (_) {}
    if (this.el) {
      try { this.el.pause(); } catch (_) {}
      try { this.el.src = ''; } catch (_) {}
      this.el = null;
    }
    if (this.src) {
      try { URL.revokeObjectURL(this.src); } catch (_) {}
      this.src = null;
    }
  }

  speakBrowser(text) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    });
  }

  async speakServer(text) {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: this.sessionId, text }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Speech failed');
    const url = URL.createObjectURL(base64ToBlob(data.audio, data.contentType));
    this.src = url;
    await new Promise((resolve) => {
      const a = (this.el = new Audio(url));
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.play().catch(() => resolve());
    });
  }

  async speak(text) {
    if (!text) return;
    this.stop();
    try {
      if (this.engine === 'server') await this.speakServer(text);
      else await this.speakBrowser(text);
    } catch (_) {
      await this.speakBrowser(text);
    }
  }
}

export function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'audio/mpeg' });
}

export function pickAudioMime(sttProvider) {
  const opts =
    sttProvider === 'cohere'
      ? ['audio/ogg;codecs=opus', 'audio/ogg', 'audio/webm;codecs=opus', 'audio/mp4']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const m of opts) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

function encodeWav(floatSamples, sampleRate) {
  const n = floatSamples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const w = new DataView(buf);
  const putStr = (o, s) => {
    for (let i = 0; i < s.length; i++) w.setUint8(o + i, s.charCodeAt(i));
  };
  putStr(0, 'RIFF');
  w.setUint32(4, 36 + n * 2, true);
  putStr(8, 'WAVE');
  putStr(12, 'fmt ');
  w.setUint32(16, 16, true);
  w.setUint16(20, 1, true);
  w.setUint16(22, 1, true);
  w.setUint32(24, sampleRate, true);
  w.setUint32(28, sampleRate * 2, true);
  w.setUint16(32, 2, true);
  w.setUint16(34, 16, true);
  putStr(36, 'data');
  w.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, floatSamples[i]));
    w.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function cohereWavFromWebm(webmBlob) {
  const ctx = new AudioContext();
  try {
    const src = await ctx.decodeAudioData(await webmBlob.arrayBuffer());
    const rate = src.sampleRate;
    const mono = new Float32Array(src.length);
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const data = src.getChannelData(ch);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / src.numberOfChannels;
    }
    const targetRate = 16000;
    const outLen = Math.max(1, Math.round((src.length * targetRate) / rate));
    const off = new OfflineAudioContext(1, outLen, targetRate);
    const buf = off.createBuffer(1, src.length, rate);
    buf.copyToChannel(mono, 0);
    const node = off.createBufferSource();
    node.buffer = buf;
    node.connect(off.destination);
    node.start();
    const rendered = await off.startRendering();
    return encodeWav(rendered.getChannelData(0), targetRate);
  } finally {
    if (ctx.close) ctx.close().catch(() => {});
  }
}

export class Recorder {
  constructor({ sttProvider, onTranscribed, onHint }) {
    this.media = null;
    this.stream = null;
    // When the view already holds a mic stream (so VAD and video can share one
    // permission prompt), the recorder borrows it instead of opening its own.
    this.sharedStream = null;
    this.ownsStream = false;
    this.chunks = [];
    this.recording = false;
    this.sttProvider = sttProvider;
    this.onTranscribed = onTranscribed || null;
    this.onHint = onHint;
  }

  setSharedStream(stream) {
    this.sharedStream = stream || null;
  }

  hasSharedStream() {
    return Boolean(this.sharedStream && this.sharedStream.getAudioTracks().length);
  }

  toggle({ busy, sttEnabled, sessionId, speechMs = 0, setRecording }) {
    if (this.recording) {
      this.stop();
      return;
    }
    if (busy || !sttEnabled) return;
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      this.onHint('Voice input is not supported in this browser.', true);
      return;
    }
    this.onHint('');
    const begin = (s, owned) => {
      const mime = pickAudioMime(this.sttProvider);
      let media;
      try {
        media = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      } catch (err) {
        if (owned) s.getTracks().forEach((t) => t.stop());
        this.onHint('Your browser cannot record audio here.', true);
        return;
      }
      this.media = media;
      this.stream = s;
      this.ownsStream = owned;
      this.chunks = [];
      media.ondataavailable = (e) => {
        if (e.data && e.data.size) this.chunks.push(e.data);
      };
      media.onstop = () => this.process({ sessionId, speechMs });
      media.start();
      this.recording = true;
      setRecording(true);
    };

    if (this.hasSharedStream()) {
      // Borrow the shared stream. Its tracks stay open for VAD and video.
      begin(this.sharedStream, false);
      return;
    }

    getUserMediaSafe(this)
      .then((s) => begin(s, true))
      .catch((err) => {
        this.onHint(
          err.name === 'NotAllowedError' || err.name === 'SecurityError'
            ? 'Microphone access was denied — allow the mic and try again.'
            : 'Could not start the microphone.',
          true
        );
      });
  }

  stop() {
    if (!this.recording) return;
    this.recording = false;
    if (this.media && this.media.state !== 'inactive') this.media.stop();
  }

  async process({ sessionId, speechMs = 0 }) {
    const { media, stream, chunks, ownsStream } = this;
    this.media = null;
    // Only release the mic when this recorder opened it. A shared stream is
    // still feeding the voice activity detector.
    if (stream && ownsStream) stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    const mime = media && media.mimeType && /^audio\//.test(media.mimeType) ? media.mimeType : 'audio/webm';
    let blob = new Blob(chunks, { type: mime });
    this.chunks = [];
    if (!blob.size) return;
    if (this.sttProvider === 'cohere' && !/^(audio\/(ogg|wav|flac|mp3|mpeg|mpga);?)/.test(blob.type)) {
      try {
        blob = await cohereWavFromWebm(blob);
      } catch (_) {}
    }
    this.onHint('Transcribing…', true);
    try {
      const b64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
        fr.onerror = () => reject(new Error('Could not read the recording.'));
        fr.readAsDataURL(blob);
      });
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, audio: b64, contentType: blob.type }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Transcription failed');
      if (data.transcript) {
        // The caller decides whether to submit, append to the textbox, or
        // re-arm. The recorder does not assume voice mode.
        if (this.onTranscribed) this.onTranscribed(data.transcript, { speechMs });
      } else {
        this.onHint('I could not hear anything — try again.', true);
      }
    } catch (err) {
      this.onHint(err.message, true);
    } finally {
      this.onHint('');
    }
  }
}

function getUserMediaSafe(self) {
  return navigator.mediaDevices.getUserMedia({ audio: true });
}