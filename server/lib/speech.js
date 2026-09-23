const DEFAULT_PROVIDER = 'deepgram';
const MAX_TTS_CHARS = 2000;

// Nominal USD per 1 million characters, used to estimate a traceable cost per
// synthesized utterance. OpenAI publishes these model rates. Deepgram Aura is
// billed by monthly package, so it has no per-character rate here and its TTS
// rows record costUsd as null (unpriced) until a published rate exists.
const PRICING = {
  'gpt-4o-mini-tts': 0.6,
  'tts-1': 15,
};

function round6(value) {
  return Math.round(value * 1000000) / 1000000;
}

function computeCost(provider, model, text) {
  const perMillion = PRICING[model];
  if (perMillion == null) return null;
  const chars = String(text).length;
  if (chars === 0) return null;
  return round6((chars / 1e6) * perMillion);
}

async function extractAudio(res) {
  const contentType = res.headers.get('content-type') || 'audio/mpeg';
  const audio = Buffer.from(await res.arrayBuffer());
  return { audio, contentType };
}

const PROVIDERS = {
  deepgram: {
    envKey: 'DEEPGRAM_API_KEY',
    envModel: 'DEEPGRAM_TTS_MODEL',
    defaultModel: 'aura-2-en-default',
    defaultVoice: 'aura-2-en-default',
    displayName: 'Deepgram',
    url: 'https://api.deepgram.com/v1/speak',
    buildRequest({ apiKey, model, text }) {
      const params = new URLSearchParams({ model });
      return {
        url: `${this.url}?${params.toString()}`,
        options: {
          method: 'POST',
          headers: {
            authorization: `Token ${apiKey}`,
            'content-type': 'application/json',
            accept: 'audio/mpeg',
          },
          body: JSON.stringify({ text }),
        },
      };
    },
    extractAudio,
  },

  openai: {
    envKey: 'OPENAI_API_KEY',
    envModel: 'OPENAI_TTS_MODEL',
    defaultModel: 'gpt-4o-mini-tts',
    defaultVoice: 'alloy',
    displayName: 'OpenAI',
    url: 'https://api.openai.com/v1/audio/speech',
    buildRequest({ apiKey, model, voice, text }) {
      return {
        url: this.url,
        options: {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ model, voice, input: text }),
        },
      };
    },
    extractAudio,
  },
};

function createSpeaker({
  provider = process.env.TTS_PROVIDER || DEFAULT_PROVIDER,
  apiKey,
  model,
  voice = process.env.TTS_VOICE,
  fetchImpl = fetch,
  timeoutMs = 30000,
} = {}) {
  const cfg = PROVIDERS[provider];
  if (!cfg) {
    throw new Error(`Unknown TTS_PROVIDER '${provider}'. Use deepgram | openai.`);
  }
  const resolvedKey = apiKey !== undefined ? apiKey : process.env[cfg.envKey];
  const resolvedModel = model !== undefined ? model : process.env[cfg.envModel] || cfg.defaultModel;
  const resolvedVoice = voice || cfg.defaultVoice;

  const speaker = {
    provider,
    model: resolvedModel,
    voice: resolvedVoice,
    envKey: cfg.envKey,
    enabled: !!resolvedKey,
    maxTextChars: MAX_TTS_CHARS,
    async speak({ text }) {
      if (!resolvedKey) {
        throw Object.assign(
          new Error(
            `No ${cfg.envKey} configured. Set TTS_PROVIDER=${provider} and add ${cfg.envKey} to .env to enable server-side voice. Until then the browser's built-in text-to-speech is used.`
          ),
          { statusCode: 503 }
        );
      }
      const clean = String(text || '').trim();
      if (clean.length === 0) {
        throw Object.assign(new Error('Nothing to speak.'), { statusCode: 400 });
      }
      if (clean.length > MAX_TTS_CHARS) {
        throw Object.assign(
          new Error(`Text is too long to speak aloud (${clean.length} chars, max ${MAX_TTS_CHARS}).`),
          { statusCode: 400 }
        );
      }
      const req = cfg.buildRequest({ apiKey: resolvedKey, model: resolvedModel, voice: resolvedVoice, text: clean });
      let res;
      try {
        res = await fetchImpl(req.url, { ...req.options, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
          throw Object.assign(
            new Error(`${cfg.displayName} TTS timed out after ${timeoutMs}ms.`),
            { statusCode: 504 }
          );
        }
        throw Object.assign(new Error(`Could not reach ${cfg.displayName} TTS: ${err.message}`), {
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
              ? `${cfg.displayName} TTS rejected the API key (${res.status}). Check ${cfg.envKey}.`
              : `${cfg.displayName} TTS responded ${res.status}: ${detail.slice(0, 300)}`
          ),
          { statusCode: auth ? 503 : 502 }
        );
      }
      const extracted = await cfg.extractAudio(res);
      if (extracted.audio.length === 0) {
        throw Object.assign(new Error(`${cfg.displayName} TTS returned empty audio.`), { statusCode: 502 });
      }
      return { ...extracted, costUsd: computeCost(provider, resolvedModel, clean) };
    },
  };
  return speaker;
}

module.exports = {
  createSpeaker,
  PROVIDERS,
  PRICING,
  computeCost,
  DEFAULT_PROVIDER,
  MAX_TTS_CHARS,
};