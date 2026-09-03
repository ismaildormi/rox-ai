'use strict';

// ZUVYR V1 foundation. No automatic provider fallback here.
// Zero prices apply ONLY to the explicitly confirmed Groq free account.
// Quotas below are an account snapshot, NOT per-user allowances or enforcement.
const MODELS = Object.freeze(Object.fromEntries(
  ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'].map(id => [id, Object.freeze({
    provider: 'groq', model: id,
    capabilities: Object.freeze(['text.chat', 'text.code']),
    inputTypes: Object.freeze(['text']),
    limits: Object.freeze({ rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 }),
    quotaScope: 'organization', verifiedAt: '2026-09-03',
  })])
));

const ownErrors = new WeakSet();
function fail(code, status) {
  const error = new Error(code);
  ownErrors.add(error);
  error.code = code;
  if (status) error.status = status;
  return error;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) throw fail('groq_messages_required');
  return messages.map(message => {
    if (!message || !['system', 'user', 'assistant'].includes(message.role)) {
      throw fail('groq_role_not_supported');
    }
    if (message.tool_calls || message.function_call) throw fail('groq_tools_not_enabled');
    let content = message.content;
    if (Array.isArray(content)) {
      if (!content.every(part => part && part.type === 'text' && typeof part.text === 'string')) {
        throw fail('groq_input_not_supported');
      }
      content = content.map(part => part.text).join('\n');
    }
    if (typeof content !== 'string' || !content.trim()) throw fail('groq_text_required');
    return { role: message.role, content };
  });
}

function createGroqFreeAdapter({
  fetchImpl = globalThis.fetch,
  getApiKey = () => process.env.GROQ_API_KEY,
  isFreeTierConfirmed = () => process.env.ZUVYR_GROQ_FREE_TIER_CONFIRMED === 'true',
} = {}) {
  return {
    label: 'Groq - ZUVYR verified free-tier models',
    async call(model, messages, opts = {}) {
      if (!Object.hasOwn(MODELS, model)) throw fail('groq_model_not_allowed');
      if (!isFreeTierConfirmed()) throw fail('groq_free_tier_not_confirmed');
      if (opts.baseUrl || opts.apiKey || opts.tools || opts.tool_choice) throw fail('groq_option_not_supported');
      const normalized = normalizeMessages(messages);
      const key = getApiKey();
      if (typeof key !== 'string' || !/^gsk_[\x21-\x7e]+$/.test(key)) {
        throw fail('groq_key_missing_or_invalid');
      }
      const tokens = opts.maxOutputTokens === undefined ? 2048 : opts.maxOutputTokens;
      if (!Number.isSafeInteger(tokens) || tokens < 1) throw fail('groq_invalid_output_limit');
      // Conservative foundation cap; Code Studio budgets are a later integration.
      const maxTokens = Math.min(tokens, 2048);
      const timeoutMs = opts.timeoutMs === undefined ? 15000 : opts.timeoutMs;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
        throw fail('groq_invalid_timeout');
      }
      const effort = opts.reasoningEffort || 'low';
      if (!['low', 'medium', 'high'].includes(effort)) throw fail('groq_invalid_reasoning_effort');
      const controller = new AbortController();
      const external = opts.signal;
      if (external && (typeof external.addEventListener !== 'function' || typeof external.removeEventListener !== 'function')) {
        throw fail('groq_invalid_signal');
      }
      if (external?.aborted) throw fail('groq_cancelled');
      const cancel = () => controller.abort();
      external?.addEventListener('abort', cancel, { once: true });
      let timer;
      try {
        // Race covers fetch AND response body. Abort stops the transport as well.
        const work = async () => {
          const response = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST', signal: controller.signal,
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify({ model, messages: normalized,
              max_completion_tokens: maxTokens, reasoning_effort: effort,
              include_reasoning: false, stream: false }),
          });
          if (!response.ok) {
            const error = fail(response.status === 429 ? 'groq_rate_limited' : `groq_http_${response.status}`, response.status);
            const retry = response.headers?.get('retry-after');
            if (retry && /^\d+$/.test(retry)) error.retryAfterSeconds = Math.min(Number(retry), 86400);
            throw error;
          }
          const data = await response.json();
          if (data.model !== model) throw fail('groq_response_model_mismatch');
          const choice = data.choices?.[0];
          if (choice?.finish_reason !== 'stop') throw fail('groq_incomplete_response');
          const text = choice?.message?.content;
          if (typeof text !== 'string' || !text.trim()) throw fail('groq_empty_response');
          const usage = data.usage;
          if (!usage || !['prompt_tokens', 'completion_tokens', 'total_tokens'].every(
            key => Number.isSafeInteger(usage[key]) && usage[key] >= 0
          )) throw fail('groq_invalid_usage');
          if (usage.cost != null && Number(usage.cost) !== 0) throw fail('groq_unexpected_billed_cost');
          return { text, model, provider: 'groq', finish_reason: 'stop', usage: {
            prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens, cost: 0,
          }, cost_basis: 'confirmed_groq_free_tier' };
        };
        return await Promise.race([
          work(), new Promise((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(fail('groq_timeout')); }, timeoutMs);
          }),
          new Promise((_, reject) => {
            controller.signal.addEventListener('abort', () => reject(fail(external?.aborted ? 'groq_cancelled' : 'groq_timeout')), { once: true });
          }),
        ]);
      } catch (error) {
        if (external?.aborted) throw fail('groq_cancelled');
        if (controller.signal.aborted) throw fail('groq_timeout');
        // Never forward raw provider bodies, headers, prompt data or key-bearing errors.
        if (ownErrors.has(error)) throw error;
        throw fail('groq_network_or_response_error');
      } finally {
        clearTimeout(timer);
        external?.removeEventListener('abort', cancel);
      }
    },
  };
}

module.exports = { MODELS, normalizeMessages, createGroqFreeAdapter };
