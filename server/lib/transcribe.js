const DEFAULT_PROVIDER = 'deepgram';
const DEFAULT_COHERE_LANGUAGE = 'en';

// Per-minute cost in USD, keyed by model — same shape as callModel.js's
// PRICING table, so one model maps to one number.
const PRICING = {
  'nova-3': 0.0059,
  'whisper-1': 0.006,
  'cohere-transcribe-03-2026': 0.006,
};

// Nominal encoded audio bitrate (bit/s) per mime type, used to estimate the
// clip length from its byte size so cost can be computed without decoding.
// Since the server never decodes audio, duration isn't known exactly; these
// are close enough for a per-role cost row, no different in spirit from
// callModel.js estimating from token counts.
const EST_BITRATE = {
  'audio/webm': 48000,
  'audio/ogg': 48000,
  'audio/mp4': 64000,
  'audio/mpeg': 64000,
  'audio/mpga': 64000,
  'audio/wav': 705600,
  'audio/flac': 200000,
};

// Cohere's batch transcription accepts flac, mp3, mpeg, mpga, ogg, and wav —
// notably not webm/opus, which is what Chrome's MediaRecorder produces. The
// server won't convert formats (zero-dependency repo), so the cohere branch
// gates on the mime and errors clearly instead of surfacing a provider 422.
const COHERE_FORMATS = ['flac', 'mp3', 'mpeg', 'mpga', 'ogg', 'wav'];

function mimeKind(contentType) {
  return String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function buildMultipart(fields, { filename = 'recording' } = {}) {
  const boundary = `----pm-transcribe-${Math.random().toString(36).slice(2)}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    if (Buffer.isBuffer(value)) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\n`
        )
      );
    } else {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n`));
      chunks.push(Buffer.from(String(value)));
      chunks.push(Buffer.from('\r\n'));
      continue;
    }
    chunks.push(Buffer.from('Content-Type: application/octet-stream\r\n\r\n'));
    chunks.push(value);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

function estimateMinutes(buffer, contentType) {
  const kind = mimeKind(contentType);
  const bitrate = EST_BITRATE[kind] || 48000;
  const seconds = (buffer.length * 8) / bitrate;
  return Math.max(0, seconds / 60);
}

function calculateCost(provider, model, audio, contentType) {
  const perMinute = PRICING[model];
  if (perMinute == null) return null;
  const cost = estimateMinutes(audio, contentType) * perMinute;
  if (cost <= 0) return null;
  return Math.round(cost * 1e6) / 1e6;
}

const PROVIDERS = {
  deepgram: {
    envKey: 'DEEPGRAM_API_KEY',
    envModel: 'DEEPGRAM_STT_MODEL',
    defaultModel: 'nova-3',
    displayName: 'Deepgram',
    url: 'https://api.deepgram.com/v1/listen',
    buildRequest({ apiKey, model, audio, contentType }) {
      const params = new URLSearchParams({
        model,
        smart_format: 'true',
        filler_words: 'false',
      });
      return {
        url: `${this.url}?${params.toString()}`,
        options: {
          method: 'POST',
          headers: {
            authorization: `Token ${apiKey}`,
            'content-type': mimeKind(contentType) || 'audio/webm',
            accept: 'application/json',
          },
          body: audio,
        },
      };
    },
    extractTranscript(json) {
      const hits = json && json.results && json.results.channels;
      if (!Array.isArray(hits) || !hits[0] || !Array.isArray(hits[0].alternatives)) return '';
      const transcript = (hits[0].alternatives[0] && hits[0].alternatives[0].transcript) || '';
      return String(transcript).trim();
    },
  },

  openai: {
    envKey: 'OPENAI_API_KEY',
    envModel: 'OPENAI_STT_MODEL',
    defaultModel: 'whisper-1',
    displayName: 'OpenAI',
    url: 'https://api.openai.com/v1/audio/transcriptions',
    buildRequest({ apiKey, model, audio }) {
      const { boundary, body } = buildMultipart({ model, file: audio });
      return {
        url: this.url,
        options: {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': `multipart/form-data; boundary=${boundary}`,
          },
          body,
        },
      };
    },
    extractTranscript(json) {
      return String((json && json.text) || '').trim();
    },
  },

  cohere: {
    envKey: 'COHERE_API_KEY',
    envModel: 'COHERE_STT_MODEL',
    defaultModel: 'cohere-transcribe-03-2026',
    displayName: 'Cohere',
    url: 'https://api.cohere.com/v2/audio/transcriptions',
    buildRequest({ apiKey, model, audio, contentType, language }) {
      const kind = mimeKind(contentType);
      const fmt = kind.replace(/^audio\//, '');
      if (!COHERE_FORMATS.includes(fmt)) {
        throw Object.assign(
          new Error(
            `Cohere STT does not accept ${kind || 'that audio format'} — supported formats are ${COHERE_FORMATS.join(', ')}. Use Deepgram or OpenAI for webm, or record with a browser that emits ogg.`
          ),
          { statusCode: 400 }
        );
      }
      const { boundary, body } = buildMultipart({ model, language, file: audio }, { filename: `recording.${fmt}` });
      return {
        url: this.url,
        options: {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': `multipart/form-data; boundary=${boundary}`,
          },
          body,
        },
      };
    },
    extractTranscript(json) {
      return String((json && json.text) || '').trim();
    },
  },
};

function createTranscriber({
  provider = process.env.STT_PROVIDER || DEFAULT_PROVIDER,
  apiKey,
  model,
  language = process.env.STT_LANGUAGE || DEFAULT_COHERE_LANGUAGE,
  fetchImpl = fetch,
  timeoutMs = 30000,
} = {}) {
  const cfg = PROVIDERS[provider];
  if (!cfg) {
    throw new Error(`Unknown STT_PROVIDER '${provider}'. Use deepgram | openai | cohere.`);
  }
  const resolvedKey = apiKey !== undefined ? apiKey : null;
  const resolvedModel = model !== undefined ? model : process.env[cfg.envModel] || cfg.defaultModel;

  const transcriber = {
    provider,
    model: resolvedModel,
    envKey: cfg.envKey,
    language,
    enabled: !!resolvedKey,
    async transcribe({ audio, contentType }) {
      if (!resolvedKey) {
        throw Object.assign(
          new Error(
            `No speech-to-text key on this request. Add your key in Settings → AI services, then start a fresh interview.`
          ),
          { statusCode: 503 }
        );
      }
      if (!audio || audio.length === 0) {
        throw Object.assign(new Error('No audio received.'), { statusCode: 400 });
      }
      const req = cfg.buildRequest({ apiKey: resolvedKey, model: resolvedModel, language, audio, contentType });
      let res;
      try {
        res = await fetchImpl(req.url, { ...req.options, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
          throw Object.assign(
            new Error(`${cfg.displayName} STT timed out after ${timeoutMs}ms. Try a shorter answer or a different audio format.`),
            { statusCode: 504 }
          );
        }
        throw Object.assign(new Error(`Could not reach ${cfg.displayName} STT: ${err.message}`), {
          statusCode: 502,
        });
      }
      if (!res.ok) {
        let detail = '';
        try {
          detail = await res.text();
        } catch (_) {}
        const auth = res.status === 401 || res.status === 403;
        throw Object.assign(
          new Error(
            auth
              ? `${cfg.displayName} STT rejected the API key (${res.status}). Check the key you added in Settings → AI services.`
              : `${cfg.displayName} STT responded ${res.status}: ${detail.slice(0, 300)}`
          ),
          { statusCode: auth ? 503 : 502 }
        );
      }
      const json = await res.json();
      return {
        transcript: cfg.extractTranscript(json),
        costUsd: calculateCost(provider, resolvedModel, audio, contentType),
      };
    },
  };
  return transcriber;
}

module.exports = {
  createTranscriber,
  PROVIDERS,
  PRICING,
  buildMultipart,
  estimateMinutes,
  calculateCost,
  mimeKind,
  DEFAULT_PROVIDER,
  DEFAULT_COHERE_LANGUAGE,
  COHERE_FORMATS,
};