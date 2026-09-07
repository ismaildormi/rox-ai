'use strict';

const config = require('../config/chat-system.v1.json');
const { normalizeSources } = require('./sourceContract');

function researchError(code) { const error = new Error(code); error.code = code; return error; }

function createResearchPlan({ question, queries }) {
  const normalizedQuestion = String(question || '').replace(/\s+/g, ' ').trim();
  if (!normalizedQuestion || normalizedQuestion.length > 1000) throw researchError('invalid_research_question');
  const normalizedQueries = [...new Set((Array.isArray(queries) ? queries : [normalizedQuestion])
    .map(value => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
  if (!normalizedQueries.length || normalizedQueries.length > config.deepResearch.maxQueriesPerRound) throw researchError('invalid_research_queries');
  return Object.freeze({ version: 'pack-03.research-plan.v1', question: normalizedQuestion, queries: Object.freeze(normalizedQueries) });
}

async function executeResearch(plan, { search, composeReport, allowExecution = false } = {}) {
  if (allowExecution !== true) throw researchError('deep_research_disabled');
  if (typeof search !== 'function' || typeof composeReport !== 'function') throw researchError('research_executor_required');
  const collected = [];
  for (const query of plan.queries) {
    const results = await search(query);
    if (Array.isArray(results)) collected.push(...results);
    if (collected.length >= config.deepResearch.maxSources) break;
  }
  const sources = normalizeSources(collected.slice(0, config.deepResearch.maxSources));
  const domains = new Set(sources.map(source => source.url && new URL(source.url).hostname).filter(Boolean));
  if (domains.size < config.deepResearch.minimumIndependentDomains) throw researchError('insufficient_independent_sources');
  const report = await composeReport({ question: plan.question, sources });
  return Object.freeze({ status: 'succeeded', report: String(report || ''), sources, independentDomains: domains.size });
}

module.exports = { createResearchPlan, executeResearch };
