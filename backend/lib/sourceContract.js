'use strict';

const config = require('../config/chat-system.v1.json');
const SOURCE_TYPES = new Set(['file', 'web', 'product', 'memory']);

function sourceError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function safeHttpsUrl(value) {
  if (!value) return null;
  let url;
  try { url = new URL(String(value)); } catch (_) { throw sourceError('invalid_source_url'); }
  if (!config.sources.allowedUrlProtocols.includes(url.protocol)) throw sourceError('invalid_source_url_protocol');
  url.hash = '';
  return url.toString();
}

function normalizeSource(source, index = 0) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw sourceError('invalid_source');
  const type = String(source.type || (source.assetType ? 'file' : 'web')).toLowerCase();
  if (!SOURCE_TYPES.has(type)) throw sourceError('invalid_source_type');
  const title = String(source.title || source.name || `${type} source ${index + 1}`)
    .replace(/\s+/g, ' ').trim().slice(0, config.sources.maxTitleCharacters);
  const snippet = String(source.snippet || '').replace(/\s+/g, ' ').trim().slice(0, config.sources.maxSnippetCharacters);
  const url = safeHttpsUrl(source.url || null);
  if ((type === 'web' || type === 'product') && !url) throw sourceError('source_url_required');
  const externalId = String(source.id || source.externalId || '').trim().slice(0, 180) || null;
  return Object.freeze({
    citationId: String(source.citationId || `source-${index + 1}`).slice(0, 80),
    type,
    title,
    url,
    snippet,
    externalId,
    mimeType: source.mimeType ? String(source.mimeType).slice(0, 120) : null,
    metadata: source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata) ? { ...source.metadata } : {}
  });
}

function normalizeSources(sources = []) {
  if (!Array.isArray(sources)) throw sourceError('sources_must_be_array');
  const output = [];
  const seen = new Set();
  for (const source of sources.slice(0, config.sources.maxPerResponse)) {
    const normalized = normalizeSource(source, output.length);
    const key = normalized.url || `${normalized.type}:${normalized.externalId || normalized.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(Object.freeze({ ...normalized, citationId: `source-${output.length + 1}` }));
  }
  return Object.freeze(output);
}

function attachmentSources(sources = []) {
  return normalizeSources(sources.map(source => ({
    type: 'file',
    id: source.id,
    title: source.name,
    mimeType: source.mimeType,
    metadata: {
      assetType: source.assetType || 'file',
      extractionStatus: source.extractionStatus || 'unsupported'
    }
  })));
}

module.exports = { SOURCE_TYPES, safeHttpsUrl, normalizeSource, normalizeSources, attachmentSources };
