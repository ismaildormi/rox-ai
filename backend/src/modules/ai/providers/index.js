// ROX AI â€” src/modules/ai/providers
//
// Makes the AI backend swappable: aiRouter.js should never again say
// `if (route.provider === 'anthropic') ... else if (route.provider ===
// 'openrouter') ...`. Instead every provider (OpenAI, Anthropic, Google,
// Groq, OpenRouter, a local/self-hosted model, a future customer-supplied
// endpoint) registers itself here under the SAME shape, and aiRouter.js
// just does `providers.call(route.provider, route.model, messages, opts)`.
// Adding provider #7 is "write an adapter, register it" â€” zero changes
// to the routing/fallback/circuit-breaker/credit logic that already works.
//
// Common adapter interface (every entry in the 'ai.providers' registry
// bucket implements this):
//   {
//     call(model, messages, opts) -> Promise<{ text: string, usage: object }>
//     // usage is returned in whatever shape the provider gives it back
//     // (lib/modelCosts.js already normalizes both the Anthropic shape
//     // {input_tokens, output_tokens} and the OpenAI-style shape
//     // {prompt_tokens, completion_tokens} â€” a new provider should use
//     // whichever of those two shapes its API natively returns, not
//     // invent a third one).
//   }
//
// opts (all optional): { maxOutputTokens, timeoutMs, apiKey, baseUrl }
// A caller-supplied apiKey/baseUrl is what "custom_ai_models" (a user's
// own key against a provider already registered here, or a fully custom
// OpenAI-compatible endpoint) plugs into later â€” see registerOpenAiCompatible().

const registry = require('../../../core/registry');

const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 2048);
const BUCKET = 'ai.providers';

/**
 * Registers an adapter under a provider key. Called once per provider,
 * below, at module load â€” but any module (including a future plugin)
 * can call this to add a provider without touching this file.
 * @param {string} key e.g. 'anthropic', 'openai', 'google', 'groq', 'openrouter', 'local'
 * @param {{call: Function, label?: string}} adapter
 */
function registerProvider(key, adapter) {
  if (typeof adapter.call !== 'function') {
    throw new Error(`Provider "${key}" must implement call(model, messages, opts)`);
  }
  registry.register(BUCKET, key, adapter);
}

function getProvider(key) {
  return registry.get(BUCKET, key);
}

function listProviders() {
  return registry.list(BUCKET).map(({ key, value }) => ({ key, label: value.label || key }));
}

/**
 * Single entry point aiRouter.js (or anything else) should call instead
 * of branching on provider name itself.
 */
async function call(providerKey, model, messages, opts = {}) {
  const adapter = getProvider(providerKey);
  if (!adapter) {
    const err = new Error(`unknown_provider_${providerKey}`);
    err.code = 'unknown_provider';
    throw err;
  }
  return adapter.call(model, messages, { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS, ...opts });
}

// --- Built-in adapters -----------------------------------------------

// Anthropic (Messages API). Same request shape aiRouter.js's old
// callAnthropic() used â€” behavior-preserving move, not a rewrite.
registerProvider('anthropic', {
  label: 'Anthropic',
  async call(model, messages, opts = {}) {
    const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: opts.maxOutputTokens, messages }),
    });
    if (!res.ok) throw new Error(`anthropic_${res.status}`);
    const data = await res.json();
    const text = (data.content || []).map((b) => b.text || '').join('');
    return { text, usage: data.usage || {} };
  },
});

// OpenRouter â€” itself a multi-provider proxy (this is how the free
// Qwen/DeepSeek chain is served today), kept as one adapter since it
// already speaks the OpenAI-compatible chat/completions shape.
registerProvider('openrouter', {
  label: 'OpenRouter',
  async call(model, messages, opts = {}) {
    const apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY;
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: opts.maxOutputTokens,
        ...(messages.some(message =>
          Array.isArray(message?.content) &&
          message.content.some(part => part?.type === 'file')
        )
          ? {
              plugins: [
                {
                  id: 'file-parser',
                  pdf: {
                    engine: 'cloudflare-ai'
                  }
                }
              ]
            }
          : {})
      }),
    });
    if (!res.ok) throw new Error(`openrouter_${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    return { text, usage: data.usage || {} };
  },
});

// OpenAI â€” same chat/completions shape as OpenRouter (OpenRouter was
// modeled on it), so this is a genuinely small adapter: different base
// URL and env var, nothing else changes.
registerProvider('openai', {
  label: 'OpenAI',
  async call(model, messages, opts = {}) {
    const apiKey = opts.apiKey || process.env.OPENAI_API_KEY;
    const baseUrl = opts.baseUrl || 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, max_tokens: opts.maxOutputTokens }),
    });
    if (!res.ok) throw new Error(`openai_${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    return { text, usage: data.usage || {} };
  },
});

// Google (Gemini). Different request/response shape (contents[] with
// role 'user'/'model', parts[].text) â€” this is exactly the case the
// registry pattern is for: the adapter absorbs the shape difference,
// callers never see it.
registerProvider('google', {
  label: 'Google Gemini',
  async call(model, messages, opts = {}) {
    const apiKey = opts.apiKey || process.env.GOOGLE_API_KEY;
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: opts.maxOutputTokens },
        }),
      }
    );
    if (!res.ok) throw new Error(`google_${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    const usage = {
      prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
      completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
    };
    return { text, usage };
  },
});

// Groq â€” OpenAI-compatible chat/completions API, same pattern as OpenAI.
registerProvider('groq', require('./groqFree').createGroqFreeAdapter());

// Local / self-hosted (Ollama, vLLM, LM Studio, etc.) â€” anything that
// speaks the OpenAI-compatible /v1/chat/completions shape on a local or
// private baseUrl. No API key required by default (local networks
// typically don't need one); pass opts.apiKey if the deployment does.
registerProvider('local', {
  label: 'Local / self-hosted',
  async call(model, messages, opts = {}) {
    const baseUrl = opts.baseUrl || process.env.LOCAL_MODEL_BASE_URL || 'http://localhost:11434/v1';
    const headers = { 'content-type': 'application/json' };
    if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, max_tokens: opts.maxOutputTokens }),
    });
    if (!res.ok) throw new Error(`local_${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    return { text, usage: data.usage || {} };
  },
});

/**
 * Extension point for `custom_ai_models`: registers a new provider key
 * at runtime for any endpoint that speaks the OpenAI-compatible
 * /v1/chat/completions shape (OpenAI, Groq, OpenRouter, local runtimes,
 * and most third-party "OpenAI-compatible" hosts all qualify). Lets a
 * user/org bring their own {endpoint, apiKey} without a code change â€”
 * the feature flag gates whether this is ever called, this function
 * doesn't gate itself.
 * @param {string} key unique provider key, e.g. `custom:${orgId}`
 * @param {{baseUrl: string, apiKey?: string, label?: string}} settings
 */
function registerOpenAiCompatible(key, settings) {
  registerProvider(key, {
    label: settings.label || key,
    async call(model, messages, opts = {}) {
      const headers = { 'content-type': 'application/json' };
      const apiKey = opts.apiKey || settings.apiKey;
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const res = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, max_tokens: opts.maxOutputTokens }),
      });
      if (!res.ok) throw new Error(`${key}_${res.status}`);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      return { text, usage: data.usage || {} };
    },
  });
}

module.exports = { registerProvider, registerOpenAiCompatible, getProvider, listProviders, call };

