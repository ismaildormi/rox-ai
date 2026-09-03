'use strict';
// Offline tests only. No credentials, network, database or application startup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function run({ adapterModule, modelConfig, providerSource }) {
  const { MODELS, createGroqFreeAdapter } = adapterModule;
  let count = 0;
  async function test(name, work) { await work(); count++; console.log('PASS: ' + name); }
  const ids = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];
  const messages = [{ role: 'user', content: 'hello' }];
  const dummy = 'gsk_OFFLINE_TEST_NOT_A_REAL_KEY';
  let calls = [];
  const good = model => ({ ok: true, json: async () => ({ model,
    choices: [{ finish_reason: 'stop', message: { content: 'ZUVYR_OK' } }],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  }) });
  const fake = async (url, options) => { calls.push({ url, options }); return good(JSON.parse(options.body).model); };
  const make = overrides => createGroqFreeAdapter({ fetchImpl: fake, getApiKey: () => dummy,
    isFreeTierConfirmed: () => true, ...overrides });
  const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);

  await test('two verified models, text capabilities and configured zero rates', async () => {
    assert.deepEqual(Object.keys(MODELS), ids);
    for (const id of ids) {
      assert.deepEqual(modelConfig.rates[id], { input: 0, output: 0 });
      assert.deepEqual(MODELS[id].inputTypes, ['text']);
    }
  });
  await test('successful adapter calls for both models', async () => {
    for (const id of ids) {
      const result = await make().call(id, messages);
      assert.equal(result.text, 'ZUVYR_OK'); assert.equal(result.usage.cost, 0);
      const sent = JSON.parse(calls.at(-1).options.body);
      assert.equal(sent.max_completion_tokens, 2048);
      assert.equal(sent.include_reasoning, false);
      assert.equal(sent.reasoning_effort, 'low');
      assert.equal('max_tokens' in sent, false);
    }
  });
  await test('unconfirmed account is blocked before network', async () => {
    const before = calls.length;
    await rejects(make({ isFreeTierConfirmed: () => false }).call(ids[0], messages), 'groq_free_tier_not_confirmed');
    assert.equal(calls.length, before);
  });
  await test('unknown model, unsupported input and tools are blocked', async () => {
    const before = calls.length;
    await rejects(make().call('paid-model', messages), 'groq_model_not_allowed');
    for (const type of ['image_url', 'input_audio', 'video_url', 'file']) {
      await rejects(make().call(ids[0], [{ role: 'user', content: [{ type }] }]), 'groq_input_not_supported');
    }
    await rejects(make().call(ids[0], messages, { tools: [] }), 'groq_option_not_supported');
    await rejects(make().call(ids[0], messages, { apiKey: dummy }), 'groq_option_not_supported');
    assert.equal(calls.length, before);
  });
  await test('invalid credentials are blocked without exposure', async () => {
    const before = calls.length;
    for (const key of [undefined, '', 'x', 'gsk_abc\n']) {
      await rejects(make({ getApiKey: () => key }).call(ids[0], messages), 'groq_key_missing_or_invalid');
    }
    assert.equal(calls.length, before);
  });
  await test('text parts normalize and output tokens are capped', async () => {
    await make().call(ids[0], [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], { maxOutputTokens: 8192 });
    const sent = JSON.parse(calls.at(-1).options.body);
    assert.equal(sent.messages[0].content, 'hello'); assert.equal(sent.max_completion_tokens, 2048);
    await rejects(make().call(ids[0], messages, { maxOutputTokens: NaN }), 'groq_invalid_output_limit');
  });
  await test('429 and 401 are explicit, with no retry or provider fallback', async () => {
    for (const status of [429, 401]) {
      let attempts = 0;
      const adapter = make({ fetchImpl: async () => {
        attempts++; return { ok: false, status, headers: { get: () => '12' } };
      } });
      await assert.rejects(adapter.call(ids[0], messages), error =>
        error.status === status && error.retryAfterSeconds === 12 && !error.message.includes(dummy));
      assert.equal(attempts, 1);
    }
  });
  await test('empty, truncated, wrong-model and billed responses are rejected', async () => {
    for (const [mutate, code] of [
      [data => { data.choices[0].message.content = ''; }, 'groq_empty_response'],
      [data => { data.choices[0].finish_reason = 'length'; }, 'groq_incomplete_response'],
      [data => { data.model = 'other'; }, 'groq_response_model_mismatch'],
      [data => { data.usage.cost = 0.01; }, 'groq_unexpected_billed_cost'],
      [data => { delete data.usage; }, 'groq_invalid_usage'],
    ]) {
      const data = await good(ids[0]).json(); mutate(data);
      await rejects(make({ fetchImpl: async () => ({ ok: true, json: async () => data }) }).call(ids[0], messages), code);
    }
  });
  await test('transport exceptions do not leak secrets', async () => {
    await rejects(make({ fetchImpl: async () => { throw new Error(dummy); } }).call(ids[0], messages), 'groq_network_or_response_error');
  });
  await test('timeout aborts network operation', async () => {
    let signal;
    const adapter = make({ fetchImpl: async (_, opts) => { signal = opts.signal; return new Promise(() => {}); } });
    await rejects(adapter.call(ids[0], messages, { timeoutMs: 10 }), 'groq_timeout');
    assert.equal(signal.aborted, true);
  });
  await test('timeout includes response body reading', async () => {
    await rejects(make({ fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }) })
      .call(ids[0], messages, { timeoutMs: 10 }), 'groq_timeout');
  });
  await test('cancellation is supported', async () => {
    const controller = new AbortController();
    const adapter = make({ fetchImpl: async () => new Promise(() => {}) });
    const pending = adapter.call(ids[0], messages, { signal: controller.signal });
    controller.abort(); await rejects(pending, 'groq_cancelled');
  });
  await test('existing provider registry resolves the new Groq adapter', async () => {
    const entries = new Map();
    const sandbox = { module: { exports: {} }, process: { env: {} },
      require(id) {
        if (id === '../../../core/registry') return {
          register: (bucket, key, value) => entries.set(key, value),
          get: (bucket, key) => entries.get(key),
          list: () => [...entries].map(([key, value]) => ({ key, value })),
        };
        if (id === './groqFree') return { createGroqFreeAdapter: () => make() };
        throw new Error('Unexpected import: ' + id);
      },
      fetch: () => { throw new Error('Unexpected legacy provider call'); },
    };
    vm.runInNewContext(providerSource, sandbox);
    assert.equal(entries.size, 6);
    const result = await sandbox.module.exports.call('groq', ids[0], messages);
    assert.equal(result.text, 'ZUVYR_OK');
  });
  return count;
}

module.exports = { run };
if (require.main === module) {
  run({ adapterModule: require('./src/modules/ai/providers/groqFree'),
    modelConfig: JSON.parse(fs.readFileSync(path.join(__dirname, 'config/models.json'), 'utf8')),
    providerSource: fs.readFileSync(path.join(__dirname, 'src/modules/ai/providers/index.js'), 'utf8'),
  }).then(count => console.log(`OFFLINE TEST GROUPS: ${count}; NETWORK / DATABASE CALLS: NONE`))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
