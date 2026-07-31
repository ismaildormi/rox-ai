// ROX AI — src/modules/plugins
// Extension point for "Plugins", "Extensions", "Marketplace", and
// "Community Templates" (flags: plugins, extensions, marketplace,
// community_templates). A plugin manifest is deliberately small and
// declarative so a future review/approval flow (required before any
// third-party code runs against user data) has a fixed shape to check:
//
//   { key, name, version, tools: [toolKey, ...], permissions: [...] }
//
// Installing a plugin means: validate the manifest, register each of
// its tools into 'ai.tools' (src/modules/ai/tools) under a namespaced
// key (e.g. `plugin:<key>:<tool>`), and record the install in table
// `plugin_installations` (see 12_extension_schema.sql) scoped to a
// user or org. No sandboxing/execution model is implemented yet —
// that's the real work when this flag turns on, deliberately not
// guessed at here.

async function listInstalled(/* userId or orgId */) {
  return [];
}

async function installPlugin(/* manifest, targetId */) {
  throw Object.assign(new Error('Plugins are not implemented yet.'), { code: 'not_implemented' });
}

module.exports = { listInstalled, installPlugin };
