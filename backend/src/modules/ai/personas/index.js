// ROX AI — src/modules/ai/personas
// Extension point for "Custom AI Personas" (flag: ai_personas). A
// persona is a named system-prompt + model-preference bundle a user or
// org can create and reuse across chats. Storage: table `ai_personas`
// (see 12_extension_schema.sql). aiRouter.js's routeRequest() is
// expected to accept an optional `personaId` and prepend the stored
// system prompt — no change to its fallback/circuit-breaker logic.

async function listPersonas(/* userId, orgId */) {
  return [];
}

async function getPersona(/* personaId */) {
  return null;
}

module.exports = { listPersonas, getPersona };
