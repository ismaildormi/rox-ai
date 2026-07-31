// ROX AI — cli/lib/group.js
//
// Every top-level entry in cli/rox.js's `commands` map is a function
// `(args) => Promise<void>`. A "group" (e.g. `rox ai <sub>`, `rox
// update <sub>`) is just a handler shaped like that which does one
// more level of dispatch on `args[0]` before running — so rox.js
// itself never needs to know a group is a group instead of a plain
// command. This is the same idea as src/core/registry.js on the
// backend (one generic mechanism instead of one bespoke thing per
// feature), kept separate from it because the CLI is a standalone
// entrypoint that shouldn't import backend code just for dispatch.
//
// A group can also have a `default` subcommand, which runs when no
// subcommand (or a bare `--flag`) is given — e.g. `rox update` with no
// args still runs the full update, `rox update models` runs only the
// models refresh.

const { log } = require('./util');

/**
 * @param {object} opts
 * @param {string} opts.name        group name as typed, e.g. 'ai'
 * @param {string} opts.description one-line description for help output
 * @param {object} opts.subcommands map of subcommand name -> { handler, summary }
 * @param {string} [opts.defaultSubcommand] subcommand to run when args[0] is missing or starts with '-'
 * @returns {(args: string[]) => Promise<void>}
 */
function makeGroup({ name, description, subcommands, defaultSubcommand }) {
  function helpText() {
    const lines = Object.entries(subcommands).map(
      ([key, { summary }]) => `  rox ${name} ${key.padEnd(12)} ${summary}`
    );
    return `ROX AI — ${name}${description ? ': ' + description : ''}\n\nSubcommands:\n${lines.join('\n')}\n`;
  }

  async function group(args = []) {
    const [first, ...rest] = args;

    if (first === '-h' || first === '--help' || first === 'help') {
      console.log(helpText());
      return;
    }

    const isFlag = typeof first === 'string' && first.startsWith('-');
    const subName = !first || isFlag ? defaultSubcommand : first;
    const subArgs = !first || isFlag ? args : rest;

    if (!subName) {
      console.log(helpText());
      process.exitCode = 1;
      return;
    }

    const sub = subcommands[subName];
    if (!sub) {
      log.err(`Unknown subcommand: rox ${name} ${subName}\n`);
      console.log(helpText());
      process.exitCode = 1;
      return;
    }

    await sub.handler(subArgs);
  }

  group.helpText = helpText;
  return group;
}

module.exports = { makeGroup };
