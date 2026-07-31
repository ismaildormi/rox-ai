# ROX AI — CLI Reference

The whole platform — API server, background worker, database schema,
backups — is managed through one entrypoint: `cli/rox.js`. This is
what `rox setup`/`rox start`/etc. actually do, in enough detail to
debug when a step fails.

## Install

```bash
cd rox-ai-project
npm install          # installs the CLI's own deps (cross-spawn, tar) from the root package.json
npm link             # optional: makes `rox` available globally instead of ./cli/rox.js
```

Everything below works either as `rox <command>` (after `npm link`) or
`./cli/rox.js <command>` (no link needed) or `npm run <command>`
(passes through to the same file). On Windows, prefer `node cli\rox.js
<command>` or `npm run <command>` over `./cli/rox.js` directly — the
`#!/usr/bin/env node` shebang at the top of that file only means
anything on POSIX shells.

## Windows support

The CLI auto-detects the OS at runtime (`cli/lib/platform.js`) and
adjusts accordingly — there's no separate Windows build or branch to
maintain. Concretely, on Windows:
- pm2 is invoked via its `.cmd`/`.exe` shim (`node_modules/.bin/pm2.cmd`),
  not the extension-less POSIX path.
- `rox setup` installs `pm2-windows-startup` to survive a reboot,
  instead of pm2's own `startup` command (which only targets
  systemd/launchd and doesn't work on native Windows).
- `rox backup`/`rox restore` build/extract the archive with the `tar`
  npm package rather than shelling out to a system `tar` binary.
- Disk usage (`rox monitor`, `rox doctor`) comes from Node's built-in
  `fs.statfsSync` rather than `df`/`du`, which don't exist on Windows.
- `pg_dump`/`psql` (used for full database backup/restore) are still
  required system tools on every OS — on Windows, install them via
  `winget install PostgreSQL.PostgreSQL` and make sure that install's
  `bin/` directory is on PATH. Without them, `rox backup`/`rox restore`
  skip just the database step and tell you so; everything else
  (config, .env, pm2, Redis via Docker) still works.
- Docker and Ollama are reached the same way on every OS: Docker via
  the `docker` CLI (Docker Desktop puts `docker.exe` on PATH), Ollama
  over its local HTTP API — neither depends on a POSIX shell.

Requires Node 18.15+ (for `fs.statfsSync`).

## Global flags

Every `rox <command>` (including subcommands like `rox ai status`)
accepts these, parsed centrally in `cli/rox.js` via `cli/lib/flags.js`
— no individual command file needs its own handling for them:

| Flag | Effect |
|---|---|
| `-h`, `--help` | Print help for that command and exit without running it. |
| `-v`, `--verbose` | Print extra step-by-step detail as the command runs. |
| `--debug` | Verbose, plus a full stack trace if the command errors. |
| `--json` | Emit one JSON object at the end (`{command, ok, durationMs, os, logs}`) instead of colored text — for scripts/CI. |
| `-s`, `--silent` | Suppress normal output; errors still print. Combine with `--json` to get only the final JSON blob. |
| `--force` | Skip safety checks a command would otherwise stop on. |
| `-y`, `--yes` | Auto-answer "yes" to any confirmation prompt (e.g. `rox restore`). |
| `--dry-run` | Show what a command *would* do — no writes, no restarts, no deletions. |
| `--fix` | Attempt the safe, automatic recovery a command already knows how to do (already used by `rox health`/`rox doctor`). |
| `--repair` | A deeper recovery than `--fix` — recreate/reinstall rather than just restart (e.g. `rox health --repair` deletes and re-registers a crashed pm2 process instead of just restarting it). |
| `--timeout <seconds>` | Fail with exit code 124 if the command hasn't finished in time. |
| `--profile` | Print how long the command took. |

Notes on how this is implemented, for anyone extending a command:
- Colored output, `log.info/ok/warn/err/step/verbose/debug` and the
  interactive/non-interactive split all live in `cli/lib/util.js` and
  `cli/lib/interactive.js` — read those instead of calling
  `console.log`/`readline` directly, so `--json`/`--silent`/`--verbose`
  keep working automatically.
- Every run is also written to `logs/cli-<date>.log` as JSON lines
  (timestamp, command, level, message) regardless of what's shown on
  screen — that's the "detailed logs" every command produces.
- `cli/lib/progress.js` has a TTY-aware progress bar (`rox backup`
  uses it) and a spinner, both silent under `--json`/`--silent`/when
  piped.
- OS detection is automatic and already centralized in
  `cli/lib/platform.js` (see "Windows support" above) — no command
  needs its own `process.platform` check.
- `--fix`/`--repair`/`--dry-run` are also left in the argv a command
  receives (in addition to being parsed into flags), so existing
  `args.includes('--fix')`-style checks (`rox health`, `rox doctor`)
  keep working unmodified; `getContext()` from `cli/lib/util.js` is
  the recommended way to read them going forward.

## Commands

### `rox setup`
First run only (safe to re-run — every step checks "already done"
first):
1. Creates `backend/.env` from `.env.example` if missing.
2. `npm install` in `backend/`.
3. Checks Redis; if it's a local address and unreachable, starts one
   via Docker (`rox-redis`, `--restart unless-stopped`).
4. Applies the SQL schema (`backend/scripts/migrate.js`) if
   `SUPABASE_DB_URL` is set — otherwise tells you to run the `.sql`
   files manually in the Supabase SQL Editor, same as before this pass.
5. Registers pm2 with the OS (`pm2 startup`) so services come back
   after a reboot. If it prints a `sudo ...` command, run that once by
   hand — pm2 can't elevate itself.

### `rox start` / `rox stop` / `rox restart`
- `start`: `pm2 startOrReload ecosystem.config.js` for both
  `rox-api` and `rox-worker`. If it fails, tries starting local Redis
  once and retries before giving up.
- `stop`: stops exactly those two processes — never touches any other
  pm2-managed process on the machine.
- `restart`: zero-downtime `pm2 reload` (new process up before the old
  one exits).

Auto-recovery from a crash doesn't need any of these — it's
`ecosystem.config.js`'s `autorestart: true` (with backoff, capped at 10
attempts) doing that continuously in the background once `start` has
run once.

### `rox update [models|providers]`
No subcommand (or `rox update full`): `git pull` (if this is a git
checkout) → `npm install` → apply any new numbered `.sql` migration →
`pm2 reload` (zero downtime). Run this after pulling a new release;
it's the one command that replaces "stop everything, copy files,
re-run schema by hand, start everything."

Two narrower, faster subcommands don't touch git/pm2 at all:
- `rox update models` — re-runs `rox ai models`'s pricing cross-check,
  then makes a live call to each provider that exposes a models-list
  endpoint (OpenRouter, OpenAI today) to confirm every routed model ID
  still exists upstream. Catches a provider deprecating/renaming a
  model before it shows up as a confusing 404 in production.
- `rox update providers` — reloads `backend/.env`, re-runs `rox ai
  providers`'s credential check, then does a lightweight live
  reachability probe against each provider's base URL. Catches a wrong
  `LOCAL_MODEL_BASE_URL`, a revoked key, or a provider outage that a
  credential-presence check alone can't see.

### `rox ai <status|providers|models|routing|health|advisor|forecast|optimize>`
Everything here reads the same modules `aiRouter.js`/`server.js` use at
runtime — nothing is a separate copy of provider/model/route data, so
it can't drift from production. `rox ai` alone (no subcommand) runs
`status`.

- `rox ai status` — one-screen summary: provider credential coverage,
  routed-model pricing coverage, configured routing features, and the
  planned-but-off AI feature flags (`custom_ai_models`, `voice_ai`,
  etc. from `config/feature-flags.json`).
- `rox ai providers` — every provider registered in
  `src/modules/ai/providers` (the same registry `aiRouter.js` calls
  through), whether its credential env var is set, and whether it's
  actually in a live `ROUTES` chain vs. just registered.
- `rox ai models` — cross-checks `config/models.json` pricing against
  `aiRouter.js`'s `ROUTES`: flags a routed model with no rate (silently
  falls back to `defaultRate`, wrong margin numbers) and lists
  registered-but-unrouted models separately.
- `rox ai routing [--load=normal|elevated|high] [--free]` — prints the
  configured `ROUTES` chains and the *effective* chain
  `getEffectiveChain()` produces for a given load level / tier, so you
  can check "what happens under high load" without generating real
  traffic.
- `rox ai health` — live circuit-breaker status (`lib/modelHealth.js`,
  backed by `07_model_health.sql`) per routed model. Needs Redis +
  Supabase; degrades with a clear message if either isn't reachable.
- `rox ai advisor [--run] [--resolve <id> applied|dismissed] [--outcome <id> <outcome> [metric=delta ...]]` — view
  the latest AI Business Advisor daily report and open recommendations
  (`src/modules/advisor`), run a fresh analysis on demand (same
  function the daily cron calls), resolve a recommendation, or record
  the measured outcome of one after the fact (`recordOutcome()` —
  the same data the dashboard's outcome form writes).
- `rox ai forecast` — just the forecast section of the latest advisor
  report. Doesn't generate a new report itself (`rox ai advisor --run`
  is the one place that happens, so two commands can't race to persist
  two reports for the same day).
- `rox ai optimize [--mode manual|automatic] [--sweep] [--revert <id>] [--safety-rules '<json>'] [--apply '<json action>']`
  — Auto Optimizer (`src/modules/optimizer`): view mode + safety rules
  + recent action log by default; change mode; run the automatic-mode
  sweep on demand instead of waiting for the daily cron; revert a
  logged action; merge-update the safety rules (`updateSafetyRules()`
  — can tighten or redefine limits, can never remove the ceiling by
  omission); or manually apply one action outside a sweep (`applyAction()`
  — the CLI equivalent of the dashboard's single-recommendation
  "Apply" button). Every action still goes through the same
  `assertWithinSafetyRules()` check and `optimizer_actions_log` audit
  trail the admin dashboard uses — nothing here bypasses it.

`rox ai advisor`/`forecast`/`optimize` need
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` in `backend/.env` and
`13_advisor_optimizer_schema.sql` applied; `rox ai status/providers/
models/routing` work without any of that (they only touch config files
and the in-process provider registry).

### `rox queue <status|clear|restart>`
BullMQ's own state for the two queues in `backend/lib/queue.js`
(`rox-image-generation`, `rox-video-generation`) — nothing here keeps
a separate count.
- `rox queue status` — job counts per state (waiting/active/completed/
  failed/delayed/paused).
- `rox queue clear [--queue=image|video] [--status=failed] --yes` —
  removes jobs in that state via BullMQ's `clean()`. Defaults to
  `failed`; needs `--yes` since it's destructive.
- `rox queue restart` — pauses then resumes both queues. This is *not*
  the same as restarting `rox-worker`'s process (`rox restart` does
  that) — it only clears queue-level dispatch state, which is what a
  Redis blip can leave stuck.

### `rox jobs [--queue=image|video] [--status=failed] [--limit=20]`
Lists individual jobs, not just counts — job ID, timestamp, attempt
count, and `failedReason` when there is one. Defaults to `failed`
jobs across both queues.

### `rox cron <status|restart>`
There's no in-process scheduler in this app — `/internal/advisor/
run-daily`, `/internal/disk/run-scan`, `/internal/maintenance/run` are
endpoints an *external* scheduler (cron, GitHub Actions, Railway cron)
calls with a shared `CRON_SECRET`. So:
- `rox cron status` checks `CRON_SECRET` is set and how recently each
  job's own persisted output (advisor report, disk snapshot) was
  written — a stale timestamp is the signal the external scheduler
  isn't calling in, since this app has no way to ask a scheduler that
  isn't its own process how it's doing.
- `rox cron restart` doesn't restart anything (there's nothing running
  to restart) — it calls the same three functions the `/internal/*`
  endpoints call, directly and locally, right now. Useful for
  confirming the jobs still work without waiting for the next
  scheduled call.

### `rox server info`
One-screen machine overview: hostname, platform, Node version, uptime,
load average, CPU count, memory — plus `rox-api`/`rox-worker`'s pm2
status (same `pm2 jlist` `rox health` already reads). Points to `rox
monitor`/`rox ai status`/`rox queue status` for the detail that
already has its own command.

### `rox latency`
Real round-trip time to Redis (`PING`), Supabase (a `profiles` select),
and every configured AI provider's base URL — timed with
`process.hrtime`, not estimated. A response (even a 4xx) counts as a
completed round trip; only network-level failures (DNS, timeout,
connection refused) are reported as errors.

### `rox health [--fix]`
Checks, in order:
1. Are `rox-api` and `rox-worker` actually `online` in pm2 (not
   crash-looping)?
2. Does `GET /healthz` on the API respond, and what does it say about
   its own Redis/Supabase connectivity?
3. Disk space — a *fast* check only (df totals + threshold, no
   directory walk) so this stays safe to run from a cron job. Full
   breakdown is `rox monitor`, not here.

Exits `0` if everything's healthy, `1` otherwise — safe to point a
cron job or uptime monitor at. `--fix` attempts the one recovery each
failure actually has: `pm2 restart` a stopped/errored process, restart
the local Redis container if that's what `/healthz` reports as
unreachable, or — only at critical/emergency disk levels — run the
safe disk maintenance sweep (see `rox optimize` below; never anything
touching an Ollama model, uploads, or generated content). It does not
attempt to fix Supabase reachability (a managed service outage or a
wrong URL/key isn't something local recovery can do anything about) or
a genuinely crashing process past its restart cap (a code bug won't
fix itself — this is `rox health`'s honest limit, not a gap to paper
over).

### `rox doctor [--fix]`
The slower, human-facing sibling of `rox health`: same service checks,
plus the *full* disk report (categories, largest directories/files,
abnormal-growth flags) and any maintenance actions waiting on admin
confirmation. `--fix` also runs the safe disk cleanup sweep at
elevated disk levels — `rox health --fix` only does that automatically
at critical/emergency, `rox doctor --fix` does it at warning and above.
Never anything from `maintenance.js`'s `NEVER_AUTO` set, same as every
other automatic path in this CLI.

### `rox monitor [--watch] [--interval=N]` / `--settings` / `--set k=v ...`
Full Disk Space Monitor report, printed directly — total/used/free,
every category (Ollama, Docker, logs, backups, uploads*, generated
images*/videos*, cache*, database, temp* — categories marked `*` report
"not configured" unless their env var points at a real local directory,
since this deployment's generated content lives in Replicate/Supabase
Storage by default, not on local disk), largest directories/files, any
abnormal-growth flags, and plain-language recommendations ("Delete
unused Ollama models to recover 42 GB."). `--watch` repeats every
`--interval` seconds (default 30) until Ctrl+C. Requires
`backend/src/modules/diskMonitor` directly (loads `backend/.env` the
same way every other command does) — no admin token needed since it
never goes over HTTP.

`rox monitor --settings` prints the current `disk_monitor_settings`
row (thresholds, retention days, auto-fix). `rox monitor --set
autoFixEnabled=true logsRetentionDays=14 thresholds='{"warning":70}'`
updates one or more of them via the same `updateSettings()` the
dashboard's settings panel calls — `thresholds` takes a JSON object,
everything else a plain value.

### `rox optimize [--list-confirmations] [--confirm <id>] [--reject <id>] [--run <type>] [--log] [--request-confirmation ...]`
Default (no flags): runs the safe maintenance sweep — delete old temp
files, expired cache, logs past retention, compress logs, prune unused
Docker images — and reports bytes freed per action. Never touches an
Ollama model, Docker volumes, uploads, or generated content; those
show up as recommendations that say "requires confirmation" instead of
being acted on.

- `--run <actionType> [--description="..."]` — run exactly one safe
  action instead of the whole sweep (e.g. `delete_old_backups`,
  `docker_prune_images`) via the same `runAction()` the sweep calls
  per-step. Still refuses anything in `maintenance.js`'s `NEVER_AUTO`
  set.
- `--log [--limit=N]` — the raw `disk_maintenance_log` history, not
  just the current session's sweep output.
- `--request-confirmation --action=<type> --target='<json>'
  [--bytes=N] --reason="..."` — opens a confirmation request for
  something that touches real data, the same request the dashboard's
  "Request" button creates. This is a full replacement for that
  button, not just a viewer: nothing here requires opening the
  dashboard to get a confirmation started. Then, as before:
```
rox optimize --list-confirmations
rox optimize --confirm <id>      # or --reject <id>
```
This confirm/reject step is the ONLY code path that deletes a model or
touches real content — see `ARCHITECTURE.md` §14.

### `rox backup [--no-env]`
Writes one archive: `backups/rox-backup-<timestamp>.tar.gz`, containing
a full `pg_dump` (if `SUPABASE_DB_URL` is set), `backend/config/*.json`,
and `backend/.env` (unless `--no-env`). Redis is intentionally excluded
— see the comment at the top of `cli/commands/backup.js` for why. The
archive is `chmod 600` since `.env` has real secrets in it.

### `rox restore <file> --yes [--no-env] [--skip-db]`
The one command that refuses to run without an explicit `--yes` — it
overwrites the live database. Stops both services first, restores the
DB dump + config + `.env` from the archive, then restarts. `--skip-db`
or `--no-env` let you restore only part of an archive (e.g. bring back
config without touching the live database).

### `rox logs [rox-api|rox-worker]`
Passthrough to `pm2 logs` — tails both by default.

### `rox plugins`
Lists every plugin command discovered — see **Plugins** below. Shows
name, version, source (`local:<folder>` or `npm:<package>`), and
warns about anything that failed to load instead of silently dropping
it.

## Plugins

The CLI is plugin-ready: a new `rox <command>` can be added without
touching `cli/rox.js`, anything under `cli/commands/`, or any file
under `cli/lib/`. `cli/lib/pluginLoader.js` discovers commands from
two sources every time `rox` runs, and `cli/rox.js` merges them into
the same dispatch table the built-ins live in — a plugin command gets
the exact same global-flag parsing (`--json`, `--verbose`, `--timeout`,
etc.), logging, and `logs/cli-<date>.log` capture as `rox start` does,
because it runs through the identical code path.

**1. Local folder plugins** — the fast path, no publishing step:

```
cli/plugins/<name>/
  plugin.json   { "name": "...", "description": "...", "main": "index.js", "version": "1.0.0" }
  index.js      module.exports = async function (args) { ... }
```

Drop a folder in, run `rox <name>` — that's the whole install. See
`cli/plugins/example-hello/` for a working reference (`rox hello
--name=Ada`); delete it any time, nothing else depends on it.

A plugin's `index.js` can export:
- a plain `async function(args)` — a leaf command, or
- `{ handler, description, version }` — a leaf command with metadata
  `rox plugins` displays, or
- the return value of `cli/lib/group.js`'s `makeGroup()` — a command
  with its own subcommands (`rox <name> <sub>`), the same mechanism
  `rox ai`/`rox update`/`rox queue`/`rox cron`/`rox server` already
  use.

Everything in `cli/lib/util.js` (`log`, `loadEnv`, `getContext`, …) is
available to a plugin the same way it is to a built-in command — it's
just a `require('../../lib/util')` away.

**2. npm package plugins** — for something you want to install,
version, and share: publish a package named `rox-cli-plugin-<name>`
(same export shape as above) and list it as a dependency in the
project's root `package.json`. `npm install rox-cli-plugin-<name>` is
the whole install step; the command name defaults to the part after
the prefix, or `module.exports.commandName` if the package wants to
override it.

**Rules the loader enforces, so a plugin can't surprise you:**
- A plugin can never override a built-in command name — if
  `rox-cli-plugin-backup` tried to claim `backup`, it's skipped with a
  warning (printed once, before the command runs) rather than shadowing
  `rox backup`.
- A plugin that fails to load (syntax error, missing file, doesn't
  export a function/`{handler}`) is warned about and skipped — never
  fatal to the rest of the CLI. `rox plugins` shows those warnings too.
- Discovery is local-filesystem/`require()` only — there's no
  auto-download, registry fetch, or network call anywhere in
  `pluginLoader.js`. Installing a plugin is exactly "put a file
  somewhere `require` can find it," nothing more.

## What "one command" doesn't cover (on purpose)

- **First-time Supabase project creation** — the CLI configures a
  database it's pointed at, it doesn't create the Supabase project
  itself (that's an account/billing action outside what a service-role
  key or connection string can do).
- **Provisioning the server this runs on** — `rox setup`/`start` assume
  Node 18+, and optionally Docker/psql, are already present. A fresh
  bare VM still needs those installed once.
- **Rotating secrets in `.env`** — restoring `env.backup` brings back
  whatever secrets were live at backup time; it doesn't rotate anything
  itself.

