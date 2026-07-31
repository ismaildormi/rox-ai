#!/usr/bin/env node
// ROX AI — cli/rox.js
//
// The one CLI the whole platform is managed through. Every subcommand
// is its own file in cli/commands/ — this is just dispatch + help, so
// adding command #8 later is "add a file, add a line here," the same
// registry-shaped pattern the rest of the backend uses
// (src/core/registry.js) rather than one growing switch statement.

const { log, setContext, flushJson } = require('./lib/util');
const { parseGlobalFlags, withTimeout, GLOBAL_FLAGS_HELP } = require('./lib/flags');
const { discoverPlugins } = require('./lib/pluginLoader');

const builtins = {
  setup: require('./commands/setup'),
  update: require('./commands/update/group'),
  start: require('./commands/start'),
  stop: require('./commands/stop'),
  restart: require('./commands/restart'),
  health: require('./commands/health'),
  doctor: require('./commands/doctor'),
  monitor: require('./commands/monitor'),
  optimize: require('./commands/optimize'),
  backup: require('./commands/backup'),
  restore: require('./commands/restore'),
  logs: require('./commands/logs'),
  ai: require('./commands/ai'),
  queue: require('./commands/queue'),
  jobs: require('./commands/jobs'),
  cron: require('./commands/cron'),
  server: require('./commands/server'),
  latency: require('./commands/latency'),
  plugins: require('./commands/plugins'),
};

// Plugin discovery happens on every run (cheap — a directory read plus
// a handful of `require`s) and is merged in AFTER builtins, so a
// plugin can add `rox foo` but can never shadow/override a built-in
// name — this is the one place that rule is enforced, not something
// each plugin has to respect on its own. See cli/lib/pluginLoader.js
// and docs/CLI.md § Plugins for how a new command shows up here
// without this file changing.
const pluginWarnings = [];
const discoveredPlugins = discoverPlugins((msg) => pluginWarnings.push(msg));
const commands = { ...builtins };
const pluginHelpLines = [];
for (const [name, plugin] of Object.entries(discoveredPlugins)) {
  if (builtins[name]) {
    pluginWarnings.push(`Plugin "${name}" (${plugin.source}) was skipped — a built-in command already uses that name.`);
    continue;
  }
  commands[name] = plugin.handler;
  if (plugin.helpText) commands[name].helpText = plugin.helpText;
  pluginHelpLines.push(`  ${name.padEnd(28)} ${plugin.summary || '(plugin)'}  [${plugin.source}]`);
}
const PLUGIN_HELP_BLOCK = pluginHelpLines.length
  ? `\nPlugin commands (installed on top of the above — see 'rox plugins'):\n${pluginHelpLines.join('\n')}\n`
  : '';

const HELP = `ROX AI — platform CLI

Usage: rox <command> [options]

Commands:
  setup                        First-time install: deps, .env, Redis, schema, pm2 startup
  update [models|providers]    (default) full update: pull, install deps, migrate, zero-downtime reload
                                  models    refresh model pricing + verify routed models exist upstream
                                  providers reload .env, recheck credentials, probe live reachability
  ai <status|providers|models|routing|health|advisor|forecast|optimize>   AI subsystem info (default: status) — see \`rox ai --help\`
  queue <status|clear|restart>  BullMQ image/video queues (default: status)
  jobs [--queue=] [--status=] [--limit=]   List individual jobs (default: failed, both queues)
  cron <status|restart>        The 3 scheduled /internal/* jobs (default: status)
  server <info>                 Machine + rox-api/rox-worker overview
  latency                       Round-trip time to Redis, Supabase, and each AI provider
  start                        Start rox-api + rox-worker (auto-recovers local Redis if needed)
  stop                         Stop rox-api + rox-worker
  restart                      Zero-downtime reload of both services
  health [--fix]               Check pm2 + API + Redis + Supabase + disk space; --fix attempts automatic recovery
  doctor [--fix]                Full diagnostic (services + disk + pending confirmations); --fix also runs safe disk cleanup
  monitor [--watch] [--interval=N] [--settings] [--set k=v ...]   Live disk usage report — categories, largest dirs/files, growth flags; view/edit settings
  optimize [--list-confirmations] [--confirm <id>] [--reject <id>] [--run <type>] [--log] [--request-confirmation ...]   Run the safe disk maintenance sweep, one named action, or manage confirmations for anything touching real data
  backup [--no-env]            Dump DB + config (+ .env unless --no-env) into backups/rox-backup-<ts>.tar.gz
  restore <file> --yes         Restore a backup archive (stops services first; --yes required)
  logs [rox-api|rox-worker]    Tail logs (defaults to both)
  plugins                      List installed plugin commands (cli/plugins/ + npm rox-cli-plugin-*)
${PLUGIN_HELP_BLOCK}
Every command above also accepts these (run \`rox <command> --help\` for
command-specific notes):
  -h, --help  -v, --verbose  --json  -s, --silent  --force  -y, --yes
  --dry-run  --fix  --repair  --timeout <s>  --debug  --profile

Examples:
  ./cli/rox.js setup
  ./cli/rox.js start
  ./cli/rox.js health --fix
  ./cli/rox.js health --json --silent
  ./cli/rox.js backup --dry-run
  ./cli/rox.js restore backups/rox-backup-2026-07-22T10-00-00-000Z.tar.gz --yes
  ./cli/rox.js ai status
  ./cli/rox.js update providers
`;

/** Pulls out the one HELP line for `cmd` from the block above, for `rox <cmd> --help` on commands that don't build their own help text (groups like `ai`/`update`/`queue`/`cron`/`server` already do, via lib/group.js). */
function commandHelpLine(cmd) {
  const line = HELP.split('\n').find((l) => new RegExp(`^\\s{2}${cmd}\\b`).test(l));
  return line ? line.trim() : `rox ${cmd}`;
}

async function main() {
  const [, , cmd, ...rest] = process.argv;

  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    console.log(HELP);
    process.exit(cmd ? 0 : 1);
  }

  const handler = commands[cmd];
  if (!handler) {
    console.error(`Unknown command: ${cmd}\n`);
    console.log(HELP);
    process.exit(1);
  }

  const { flags, args } = parseGlobalFlags(rest);
  setContext({ ...flags, command: cmd });

  if (pluginWarnings.length > 0 && cmd !== 'plugins') {
    for (const w of pluginWarnings) log.warn(`[plugins] ${w}`);
  }

  // --help on a leaf command (groups handle their own richer --help via
  // args[0] in lib/group.js — this only fires for commands that don't).
  if (flags.help && typeof handler.helpText !== 'function') {
    console.log(`${commandHelpLine(cmd)}\n\n${GLOBAL_FLAGS_HELP}`);
    process.exit(0);
  }

  const startedAt = Date.now();
  let ok = true;
  try {
    await withTimeout(Promise.resolve(handler(args)), flags.timeout, `rox ${cmd}`);
  } catch (err) {
    ok = false;
    const timedOut = err.code === 'ETIMEDOUT';
    log.err(`${cmd} failed: ${err.message}`);
    if (flags.debug && err.stack) console.error(paintDim(err.stack));
    process.exitCode = timedOut ? 124 : 1;
  }

  const durationMs = Date.now() - startedAt;
  if (flags.profile) log.info(`⏱  rox ${cmd} took ${durationMs}ms`);
  flushJson({ command: cmd, ok: ok && (process.exitCode ?? 0) === 0, durationMs, dryRun: flags.dryRun });

  process.exit(process.exitCode ?? 0);
}

function paintDim(s) { return process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s; }

main();
