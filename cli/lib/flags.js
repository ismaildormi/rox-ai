// ROX AI — cli/lib/flags.js
//
// The 12 flags every `rox <command>` accepts (--help, --verbose,
// --json, --silent, --force, --yes, --dry-run, --fix, --repair,
// --timeout, --debug, --profile) are parsed ONCE here, centrally, in
// cli/rox.js before a command ever runs — instead of every command
// file re-implementing its own `args.includes('--verbose')` checks.
// A command still receives these in its own argv too (see the
// PASS_THROUGH set below) so existing per-command code that already
// checks e.g. `args.includes('--fix')` keeps working unmodified.

const GLOBAL_BOOL_FLAGS = {
  '--help': 'help', '-h': 'help',
  '--verbose': 'verbose', '-v': 'verbose',
  '--json': 'json',
  '--silent': 'silent', '-s': 'silent',
  '--force': 'force',
  '--yes': 'yes', '-y': 'yes',
  '--dry-run': 'dryRun',
  '--fix': 'fix',
  '--repair': 'repair',
  '--debug': 'debug',
  '--profile': 'profile',
};

// These are left in the argv handed to the command itself, in addition
// to being parsed into `flags`, because several commands already do
// their own `args.includes('--fix')`-style check and that shouldn't
// have to change for this to work.
const PASS_THROUGH = new Set(['help', 'fix', 'repair', 'dryRun']);
const PASS_THROUGH_LITERAL = { help: '--help', fix: '--fix', repair: '--repair', dryRun: '--dry-run' };

function defaultFlags() {
  return {
    help: false, verbose: false, json: false, silent: false,
    force: false, yes: false, dryRun: false, fix: false, repair: false,
    debug: false, profile: false, timeout: 0,
  };
}

/**
 * @param {string[]} argv  everything after the command name
 * @returns {{ flags: object, args: string[] }} args is argv with the
 *   global flags stripped out (minus the PASS_THROUGH ones above).
 */
function parseGlobalFlags(argv) {
  const flags = defaultFlags();
  const args = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === '--timeout') { flags.timeout = Number(argv[++i]) || 0; continue; }
    if (a.startsWith('--timeout=')) { flags.timeout = Number(a.slice('--timeout='.length)) || 0; continue; }

    const key = GLOBAL_BOOL_FLAGS[a];
    if (key) { flags[key] = true; continue; }

    args.push(a);
  }

  for (const key of PASS_THROUGH) {
    if (flags[key] && !args.includes(PASS_THROUGH_LITERAL[key])) args.push(PASS_THROUGH_LITERAL[key]);
  }

  return { flags, args };
}

/** Races `promise` against a --timeout (seconds). No-op if seconds is 0/falsy. */
function withTimeout(promise, seconds, label) {
  if (!seconds) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`'${label}' timed out after ${seconds}s (--timeout)`);
      err.code = 'ETIMEDOUT';
      reject(err);
    }, seconds * 1000);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const GLOBAL_FLAGS_HELP = `Global flags (every command):
  -h, --help        show help for this command
  -v, --verbose     print extra detail as it runs
      --debug       verbose + full stack traces on error
      --json        emit a single machine-readable JSON result instead of text
  -s, --silent      suppress normal output (errors still shown); combine with --json for scripts
      --force       skip safety checks that would otherwise stop the command
  -y, --yes         auto-answer "yes" to any confirmation prompt
      --dry-run     show what would happen without changing anything
      --fix         attempt automatic recovery for problems this command finds
      --repair      deeper recovery than --fix (recreate/reinstall, not just restart)
      --timeout <s> fail if the command hasn't finished after <s> seconds
      --profile     print how long the command took`;

module.exports = { parseGlobalFlags, withTimeout, defaultFlags, GLOBAL_FLAGS_HELP };
