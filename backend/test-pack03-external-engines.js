'use strict';

const assert = require('node:assert/strict');
const { registerSearchProvider, executeWebSearch } = require('./lib/webSearchEngine');
const { createResearchPlan, executeResearch } = require('./lib/deepResearchEngine');
const { normalizeProduct, compareProducts } = require('./lib/shoppingEngine');

async function main() {
  let calls = 0;
  registerSearchProvider('offline', { async search({ query, limit }) {
    calls++;
    assert.equal(query, 'ZUVYR'); assert.equal(limit, 2);
    return [{ title: 'Result', url: 'https://example.com/result', snippet: 'Verified snippet' }];
  } });
  await assert.rejects(executeWebSearch({ provider: 'offline', query: 'ZUVYR' }), error => error.code === 'web_search_disabled');
  assert.equal(calls, 0);
  const search = await executeWebSearch({ provider: 'offline', query: 'ZUVYR', limit: 2 }, { allowExecution: true });
  assert.equal(search[0].type, 'web'); assert.equal(calls, 1);

  const plan = createResearchPlan({ question: 'Compare two sources', queries: ['source one', 'source two'] });
  await assert.rejects(executeResearch(plan, { search: async () => [], composeReport: async () => '' }), error => error.code === 'deep_research_disabled');
  const research = await executeResearch(plan, {
    allowExecution: true,
    search: async query => [{ title: query, url: query.endsWith('one') ? 'https://one.example/a' : 'https://two.example/b', snippet: query }],
    composeReport: async ({ sources }) => `Report with ${sources.length} sources`
  });
  assert.equal(research.independentDomains, 2); assert.equal(research.sources.length, 2);

  assert.throws(() => normalizeProduct({ title: 'Bad', price: -1, currency: 'USD', url: 'https://shop.example/bad' }), error => error.code === 'invalid_product_price');
  await assert.rejects(compareProducts({ query: 'camera', searchProducts: async () => [] }), error => error.code === 'shopping_disabled');
  const products = await compareProducts({
    query: 'camera', allowExecution: true,
    searchProducts: async () => [
      { id: 'b', title: 'B', price: 20, currency: 'USD', url: 'https://shop.example/b' },
      { id: 'a', title: 'A', price: 10, currency: 'USD', url: 'https://shop.example/a', availability: 'in_stock' }
    ]
  });
  assert.deepEqual(products.map(item => item.id), ['a', 'b']);
  console.log('PASS: Pack 03 injected Web Search, multi-source research and product comparison engines');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
