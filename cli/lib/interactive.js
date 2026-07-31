// ROX AI — cli/lib/interactive.js
//
// One confirmation prompt shared by any command that's about to do
// something destructive (restore overwriting the DB, optimize
// deleting files, repair recreating a container). Handles both modes
// every command needs to support:
//   - interactive:      a human is at a TTY -> ask, wait for an answer
//   - non-interactive:  piped/CI/cron, or --json/--silent -> never
//                        block; require --yes/--force to proceed, else
//                        say so and default to "no"
// so individual commands don't each reinvent "am I attached to a TTY".

const readline = require('readline');
const { getContext, log } = require('./util');

/**
 * @param {string} message
 * @param {{ defaultYes?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
async function confirm(message, opts = {}) {
  const ctx = getContext();

  if (ctx.yes || ctx.force) {
    log.info(`${message} → auto-confirmed (${ctx.force ? '--force' : '--yes'})`);
    return true;
  }

  if (!process.stdin.isTTY || ctx.json || ctx.silent) {
    log.warn(`${message} — non-interactive session, not proceeding. Pass --yes (or --force) to confirm automatically.`);
    return false;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = opts.defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await new Promise((resolve) => rl.question(`${message} ${suffix} `, resolve));
  rl.close();

  const trimmed = answer.trim();
  if (!trimmed) return Boolean(opts.defaultYes);
  return /^y(es)?$/i.test(trimmed);
}

/** True if this run should avoid any prompt/animation entirely (scripted/CI use). */
function isNonInteractive() {
  const ctx = getContext();
  return Boolean(ctx.json || ctx.silent || ctx.yes || ctx.force || !process.stdin.isTTY);
}

module.exports = { confirm, isNonInteractive };
