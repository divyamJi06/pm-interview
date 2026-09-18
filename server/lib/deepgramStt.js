const DEFAULT_URL = 'https://api.deepgram.com/v1/listen';
const DEFAULT_MODEL = 'nova-3';

const MIME_FALLBACK = 'audio/webm';

function buildRequest({ apiKey, model, audio, contentType }) {
  const params = new URLSearchParams({
    model,
    smart_format: 'true',
    filler_words: 'false',
  });
  return {
    url: `${DEFAULT_URL}?${params.toString()}`,
    options: {
      method: 'POST',
      headers: {
        authorization: `Token ${apiKey}`,
        'content-type': contentType || MIME_FALLBACK,
        accept: 'application/json',
      },
      body: audio,
    },
  };
}

function extractTranscript(json) {
  const hits = json && json.results && json.results.channels;
  if (!Array.isArray(hits) || !hits[0] || !Array.isArray(hits[0].alternatives)) return '';
  const transcript = (hits[0].alternatives[0] && hits[0].alternatives[0].transcript) || '';
  return String(transcript).trim();
}

function createTranscriber({
  apiKey,
  model = process.env.DEEPGRAM_STT_MODEL || DEFAULT_MODEL,
  fetchImpl = fetch,
  timeoutMs = 30000,
} = {}) {
  const resolvedKey = apiKey !== undefined ? apiKey : process.env.DEEPGRAM_API_KEY;
  const transcriber = {
    provider: 'deepgram',
    model,
    enabled: !!resolvedKey,
    async transcribe({ audio, contentType }) {
      if (!resolvedKey) {
        throw Object.assign(
          new Error('No DEEPGRAM_API_KEY configured. Add it to .env to enable voice-to-text answers.'),
          { statusCode: 503 }
        );
      }
      if (!audio || audio.length === 0) {
        throw Object.assign(new Error('No audio received.'), { statusCode: 400 });
      }
      const req = buildRequest({ apiKey: resolvedKey, model, audio, contentType });
      let res;
      try {
        res = await fetchImpl(req.url, req.options);
      } catch (err) {
        throw Object.assign(new Error(`Could not reach Deepgram STT: ${err.message}`), { statusCode: 502 });
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
              ? `Deepgram STT rejected the API key (${res.status}). Check DEEPGRAM_API_KEY.`
              : `Deepgram STT responded ${res.status}: ${detail.slice(0, 300)}`
          ),
          { statusCode: auth ? 503 : 502 }
        );
      }
      const json = await res.json();
      return extractTranscript(json);
    },
  };
  return transcriber;
}

module.exports = { createTranscriber, buildRequest, extractTranscript, DEFAULT_MODEL, DEFAULT_URL, MIME_FALLBACK };