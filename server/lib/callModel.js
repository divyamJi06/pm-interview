const DEFAULT_PROVIDER = 'cohere';

const PRICING = {
  'command-a-plus-05-2026': { input: 2.5, output: 10 },
  'command-a-03-2025': { input: 2.5, output: 10 },
  'command-r-plus-08-2024': { input: 2.5, output: 10 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-mini-2025-04-14': { input: 0.4, output: 1.6 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'claude-sonnet-5': { input: 2, output: 10 },
};

function calculateCost(model, inputTokens = 0, outputTokens = 0) {
  const pricing = PRICING[model];
  if (!pricing) return null;
  return (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output;
}

function isCohereReasoningModel(model) {
  return /^command-a-(plus|reasoning)/.test(model || '');
}

const PROVIDERS = {
  anthropic: {
    envKey: 'ANTHROPIC_API_KEY',
    envModel: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-sonnet-5',
    url: 'https://api.anthropic.com/v1/messages',
    headers: (apiKey) => ({
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }),
    body: ({ model, maxTokens, temperature, prompt }) => ({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: prompt }],
    }),
    extractText: (json) =>
      Array.isArray(json.content)
        ? json.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
        : '',
    extractUsage: (json) => {
      const usage = json?.usage;
      if (!usage) return null;
      return { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 };
    },
  },
  cohere: {
    envKey: 'COHERE_API_KEY',
    envModel: 'COHERE_MODEL',
    defaultModel: 'command-a-plus-05-2026',
    url: 'https://api.cohere.com/v2/chat',
    headers: (apiKey) => ({
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    }),
    body: ({ model, maxTokens, temperature, prompt, thinkingTokenBudget }) => ({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: prompt }],
      ...(isCohereReasoningModel(model) && thinkingTokenBudget
        ? { thinking: { token_budget: thinkingTokenBudget } }
        : {}),
    }),
    extractText: (json) =>
      Array.isArray(json?.message?.content)
        ? json.message.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('')
        : '',
    extractUsage: (json) => {
      const tokens = json?.usage?.tokens;
      if (!tokens) return null;
      return { inputTokens: tokens.input_tokens ?? 0, outputTokens: tokens.output_tokens ?? 0 };
    },
    emptyOutputHint: (json) =>
      json?.finish_reason === 'MAX_TOKENS'
        ? 'Model hit its output-token limit before writing a response (finish_reason MAX_TOKENS) — usually a very long answer. Nothing was lost; please send your answer again.'
        : null,
  },
  openai: {
    envKey: 'OPENAI_API_KEY',
    envModel: 'OPENAI_MODEL',
    defaultModel: 'gpt-4.1-mini',
    url: 'https://api.openai.com/v1/chat/completions',
    headers: (apiKey) => ({
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    }),
    body: ({ model, maxTokens, temperature, prompt }) => ({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: prompt }],
    }),
    extractText: (json) => json?.choices?.[0]?.message?.content || '',
    extractUsage: (json) => {
      const usage = json?.usage;
      if (!usage) return null;
      return { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 };
    },
  },
  groq: {
    envKey: 'GROQ_API_KEY',
    envModel: 'GROQ_MODEL',
    defaultModel: 'llama-3.3-70b-versatile',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    headers: (apiKey) => ({
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    }),
    body: ({ model, maxTokens, temperature, prompt }) => ({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: prompt }],
    }),
    extractText: (json) => json?.choices?.[0]?.message?.content || '',
    extractUsage: (json) => {
      const usage = json?.usage;
      if (!usage) return null;
      return { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 };
    },
  },
};

function resolveModel(provider, model) {
  const cfg = PROVIDERS[provider];
  if (model) return model;
  return process.env.AI_MODEL || process.env[cfg.envModel] || cfg.defaultModel;
}

function stripCodeFences(text) {
  return text
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```\s*$/g, '')
    .trim();
}

function parseJsonResponse(text) {
  const cleaned = stripCodeFences(text);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Model response contained no JSON object. Raw: ${cleaned.slice(0, 500)}`);
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function isRetryableHttpStatus(status) {
  return status === 429 || status >= 500;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createCallModel({
  provider = process.env.AI_PROVIDER || DEFAULT_PROVIDER,
  apiKey,
  model,
  maxTokens = 4096,
  temperature = 0,
  fetchImpl = fetch,
  extraHeaders,
  retries = 2,
  retryDelayMs = 400,
  thinkingTokenBudget = 2048,
} = {}) {
  const cfg = PROVIDERS[provider];
  if (!cfg) {
    throw new Error(`Unknown AI provider '${provider}'. Supported: ${Object.keys(PROVIDERS).join(', ')}.`);
  }

  const resolvedModel = resolveModel(provider, model);
  const resolvedKey = apiKey || process.env[cfg.envKey];
  if (!resolvedKey) {
    throw new Error(
      `No API key configured for provider '${provider}'. Set ${cfg.envKey} in the environment ` +
        `(or pass apiKey to createCallModel).`
    );
  }

  return async function callModel(prompt, { overrideMaxTokens, overrideTemperature, label = 'model_call', onCall } = {}) {
    const maxAttempts = Math.max(1, retries + 1);
    let lastErr = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const startedAt = Date.now();
      const record = {
        provider,
        model: resolvedModel,
        label,
        prompt,
        url: cfg.url,
        requestBody: null,
        startedAt,
        durationMs: null,
        success: false,
        error: null,
        outputText: '',
        outputJson: null,
        parsed: null,
        usage: null,
        costUsd: null,
      };

      try {
        const body = cfg.body({
          model: resolvedModel,
          maxTokens: overrideMaxTokens || maxTokens,
          temperature: overrideTemperature !== undefined ? overrideTemperature : temperature,
          prompt,
          thinkingTokenBudget,
        });
        record.requestBody = body;
        const headers = {
          ...cfg.headers(resolvedKey),
          ...(extraHeaders || {}),
        };

        let res;
        try {
          res = await fetchImpl(cfg.url, { method: 'POST', headers, body: JSON.stringify(body) });
        } catch (err) {
          throw Object.assign(new Error(`${provider} API request failed: ${err.message}`), { retryable: true });
        }

        if (!res.ok) {
          let detail = '';
          try {
            detail = await res.text();
          } catch (_) {}
          throw Object.assign(
            new Error(`${provider} API responded ${res.status}: ${detail}`),
            { retryable: isRetryableHttpStatus(res.status) }
          );
        }

        const json = await res.json();
        const text = cfg.extractText(json) || '';
        record.outputText = text;
        record.outputJson = json;

        const usage = cfg.extractUsage ? cfg.extractUsage(json) : null;
        record.usage = usage;
        if (usage) {
          record.costUsd = calculateCost(resolvedModel, usage.inputTokens, usage.outputTokens);
        }

        let parsed;
        try {
          parsed = parseJsonResponse(text);
        } catch (err) {
          if (!text.trim() && cfg.emptyOutputHint) {
            const hint = cfg.emptyOutputHint(json);
            if (hint) err.message = hint;
          }
          err.message = `${err.message}\nProvider=${provider} Model=${resolvedModel}`;
          throw err;
        }
        record.parsed = parsed;
        record.success = true;
        record.durationMs = Date.now() - startedAt;
        if (onCall) onCall(record);
        return parsed;
      } catch (err) {
        record.error = err.message;
        record.durationMs = Date.now() - startedAt;
        if (onCall) onCall(record);
        lastErr = err;
        if (!err.retryable || attempt >= maxAttempts - 1) throw err;
        await delay(retryDelayMs * 2 ** attempt);
      }
    }

    throw lastErr;
  };
}

module.exports = {
  callModel: createCallModel,
  createCallModel,
  parseJsonResponse,
  stripCodeFences,
  calculateCost,
  PRICING,
  PROVIDERS,
  DEFAULT_PROVIDER,
};