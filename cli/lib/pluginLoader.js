// ROX AI — cli/lib/pluginLoader.js
//
// Plugin discovery for the CLI. This is what makes "future commands
// addable without modifying the existing architecture" literally
// true, not just an aspiration in a comment: dispatch in cli/rox.js
// merges this module's output into the same `commands` map the
// built-ins live in, so a plugin command runs through the exact same
// global-flag parsing, --json/--silent handling, logging, and
// --timeout wrapper as `rox start` or `rox health` — nothing about
// dispatch needs a special case for "this one came from a plugin."
//
// Two discovery sources, same shape out of both:
//
//   1. Local folder plugins — cli/plugins/<name>/plugin.json
//      Drop a folder in, it's available next run. No install step,
//      no build step, nothing to publish. This is the fast path for
//      an in-house or site-specific command.
//
//   2. npm package plugins — any package named `rox-cli-plugin-*`
//      listed as a dependency in the project root package.json (the
//      same "install it, it's just there" convention eslint/babel/
//      webpack plugins use). `npm install rox-cli-plugin-foo` is the
//      whole install step.
//
// A plugin module (whichever source) exports either:
//   - a plain async function (args) => {...}                (a leaf command)
//   - { handler, description?, commandName?, version? }      (leaf, with metadata)
//   - the return value of cli/lib/group.js's makeGroup()      (a command GROUP,
//     e.g. a plugin that wants `rox foo bar`/`rox foo baz` subcommands —
//     makeGroup() already produces something with a callable shape plus
//     .helpText(), which is exactly what this loader checks for)
//
// A broken or malformed plugin is warned about and skipped — never
// fatal to the rest of the CLI. A plugin can never override a
// built-in command name (checked where this is merged, in rox.js);
// it can only add new ones.

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const PLUGINS_DIR = path.join(ROOT_DIR, 'cli', 'plugins');
const PLUGIN_NPM_PREFIX = 'rox-cli-plugin-';

/** A valid plugin export is a function, or an object with a function `.handler`. */
function isValidPlugin(mod) {
  return typeof mod === 'function' || (mod && typeof mod.handler === 'function');
}

function toEntry(mod, meta) {
  return {
    handler: typeof mod === 'function' ? mod : mod.handler,
    helpText: typeof mod.helpText === 'function' ? mod.helpText : undefined,
    summary: meta.description || mod.description || `(plugin: ${meta.source})`,
    source: meta.source,
    version: meta.version || mod.version || '0.0.0',
  };
}

function loadLocalPlugins(warn) {
  const found = {};
  if (!fs.existsSync(PLUGINS_DIR)) return found;

  let dirNames;
  try {
    dirNames = fs.readdirSync(PLUGINS_DIR);
  } catch (err) {
    warn(`Could not read cli/plugins/: ${err.message}`);
    return found;
  }

  for (const dirName of dirNames) {
    const dir = path.join(PLUGINS_DIR, dirName);
    if (!fs.statSync(dir).isDirectory()) continue;

    const manifestPath = path.join(dir, 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      warn(`cli/plugins/${dirName}/ has no plugin.json — skipping (not a plugin folder).`);
      continue;
    }

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      warn(`cli/plugins/${dirName}/plugin.json is invalid JSON — skipping: ${err.message}`);
      continue;
    }

    const name = manifest.name || dirName;
    const entryPath = path.join(dir, manifest.main || 'index.js');
    let mod;
    try {
      mod = require(entryPath);
    } catch (err) {
      warn(`Plugin "${name}" (cli/plugins/${dirName}) failed to load — skipping: ${err.message}`);
      continue;
    }

    if (!isValidPlugin(mod)) {
      warn(`Plugin "${name}" (cli/plugins/${dirName}) does not export a function or {handler} — skipping.`);
      continue;
    }

    found[name] = toEntry(mod, {
      description: manifest.description,
      version: manifest.version,
      source: `local:${dirName}`,
    });
  }
  return found;
}

function loadNpmPlugins(warn) {
  const found = {};
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  } catch {
    return found; // no root package.json readable — nothing to scan
  }

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const pluginDeps = Object.keys(deps).filter((d) => d.startsWith(PLUGIN_NPM_PREFIX));

  for (const depName of pluginDeps) {
    let mod;
    try {
      mod = require(depName);
    } catch (err) {
      warn(`npm plugin "${depName}" is listed as a dependency but failed to load — run npm install? (${err.message})`);
      continue;
    }

    if (!isValidPlugin(mod)) {
      warn(`npm plugin "${depName}" does not export a function or {handler} — skipping.`);
      continue;
    }

    const name = mod.commandName || depName.slice(PLUGIN_NPM_PREFIX.length);
    found[name] = toEntry(mod, { source: `npm:${depName}` });
  }
  return found;
}

/**
 * Discovers every plugin command from both sources. Returns a map shaped
 * like { [commandName]: { handler, helpText?, summary, source, version } }
 * — the same shape cli/rox.js's built-in `commands` entries provide
 * (a callable, optionally with .helpText()), so the two merge with no
 * adapter layer. Never throws: a bad plugin produces a warning via the
 * `warn` callback, not a crash of the whole CLI.
 */
function discoverPlugins(warn = () => {}) {
  return { ...loadNpmPlugins(warn), ...loadLocalPlugins(warn) };
}

module.exports = { discoverPlugins, PLUGINS_DIR, PLUGIN_NPM_PREFIX };
