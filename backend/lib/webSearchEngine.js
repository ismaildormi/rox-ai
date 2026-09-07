'use strict';

const registry = require('../src/core/registry');
const config = require('../config/chat-system.v1.json');
const { normalizeSources } = require('./sourceContract');

const BUCKET = 'chat.search.providers';

function searchError(code) { const error = new Error(code); error.code = code; return error; }

function registerSearchProvider(key, adapter) {
  if (!key || typeof adapter?.search !== 'function') throw searchError('invalid_search_provider');
  registry.register(BUCKET, key, { label: adapter.label || key, search: adapter.search });
}

function listSearchProviders() {
  return registry.list(BUCKET).map(({ key, value }) => ({ key, label: value.label }));
}

async function executeWebSearch({ provider, query, limit = 8 }, { allowExecution = false, context = {} } = {}) {
  if (allowExecution !== true) throw searchError('web_search_disabled');
  const normalizedQuery = String(query || '').replace(/\s+/g, ' ').trim();
  if (!normalizedQuery || normalizedQuery.length > config.webSearch.maxQueryCharacters) throw searchError('invalid_search_query');
  const safeLimit = Math.max(1, Math.min(config.webSearch.maxResults, Number(limit) || 8));
  const adapter = registry.get(BUCKET, provider);
  if (!adapter) throw searchError('unknown_search_provider');
  const results = await adapter.search({ query: normalizedQuery, limit: safeLimit }, context);
  return normalizeSources((Array.isArray(results) ? results : []).map(item => ({ ...item, type: 'web' })));
}

module.exports = { registerSearchProvider, listSearchProviders, executeWebSearch };
