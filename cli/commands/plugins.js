// ROX AI — cli/commands/plugins.js
//
// `rox plugins` — lists every plugin command cli/lib/pluginLoader.js
// discovered (local cli/plugins/<name>/ folders and npm packages named
// rox-cli-plugin-*), where it came from, and whether it loaded cleanly.
// This is the CLI's own self-description of its extension points —
// `rox --help` shows built-ins, `rox plugins` shows what's been added
// on top without anyone touching this file or rox.js.

const { log } = require('../lib/util');
const { discoverPlugins, PLUGINS_DIR, PLUGIN_NPM_PREFIX } = require('../lib/pluginLoader');

module.exports = async function plugins(args = []) {
  const warnings = [];
  const found = discoverPlugins((msg) => warnings.push(msg));
  const names = Object.keys(found);

  log.step('ROX AI — plugins');
  console.log(`  Local plugin folder: ${PLUGINS_DIR}`);
  console.log(`  npm plugin naming:   ${PLUGIN_NPM_PREFIX}*  (as a dependency in the root package.json)`);
  console.log('');

  if (names.length === 0) {
    log.info('No plugins installed.');
  } else {
    log.step(`Installed (${names.length}):`);
    for (const name of names) {
      const p = found[name];
      console.log(`  rox ${name.padEnd(14)} v${p.version}  [${p.source}]`);
      if (p.summary) console.log(`    ${p.summary}`);
    }
  }

  if (warnings.length > 0) {
    console.log('');
    log.warn(`${warnings.length} plugin(s) failed to load or were skipped:`);
    for (const w of warnings) console.log(`  - ${w}`);
  }

  console.log('');
  log.info('New commands don\'t require editing rox.js — see docs/CLI.md § Plugins for the two ways to add one.');
};
