// ROX AI — src/modules/ai/tools
// Extension point for "Custom Tools" and "MCP Servers" (flags:
// custom_tools, mcp_servers). Both land here because to a model they're
// the same thing: a named, callable capability with a JSON schema for
// its input. An MCP server is just a tool provider that proxies to a
// remote MCP endpoint instead of running local code.
//
// registry.register('ai.tools', key, definition) is the seam a plugin
// (see src/modules/plugins) or a built-in tool would both use — same
// mechanism, so "built-in tool" and "third-party plugin tool" aren't
// two different systems that later need to be reconciled.

const registry = require('../../../core/registry');

/**
 * @param {string} key unique tool identifier, e.g. 'web_search', 'mcp:filesystem'
 * @param {{description: string, inputSchema: object, handler: Function}} definition
 */
function registerTool(key, definition) {
  registry.register('ai.tools', key, definition);
}

function listTools() {
  return registry.list('ai.tools').map(({ key, value }) => ({ key, description: value.description }));
}

async function invokeTool(key, input, context) {
  const tool = registry.get('ai.tools', key);
  if (!tool) throw Object.assign(new Error(`Unknown tool: ${key}`), { code: 'unknown_tool' });
  return tool.handler(input, context);
}

module.exports = { registerTool, listTools, invokeTool };
