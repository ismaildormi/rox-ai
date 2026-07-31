// ROX AI — src/modules/ai/agents
// Extension point for "AI Agents" (flag: ai_agents). Not implemented —
// this module exists so the route, the flag check, and the shape of an
// agent definition are all decided now, so building the real thing
// later is "fill in runAgent()", not "design the system".
//
// An agent, when built, is expected to be: a named persona/prompt
// preset + an ordered list of tool keys from the 'ai.tools' registry
// (see src/modules/ai/tools) + a target model from 'ai.providers'.
// Storage: table `ai_agents` (see 12_extension_schema.sql).

const registry = require('../../../core/registry');

async function listAgents(/* userId */) {
  return []; // will read from table `ai_agents` once implemented
}

async function runAgent(/* agentId, input, context */) {
  throw Object.assign(new Error('AI agents are not implemented yet.'), { code: 'not_implemented' });
}

// Register this module itself so other code (e.g. an admin dashboard
// listing "what extension points exist") can discover it generically.
registry.register('modules', 'ai.agents', { listAgents, runAgent });

module.exports = { listAgents, runAgent };
