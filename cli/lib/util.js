// ROX AI — cli/lib/util.js
const path = require('path');
const fs = require('fs');
// cross-spawn (not node's built-in child_process directly) because
// Windows can't execute a .cmd/.bat shim the way it executes a real
// binary — child_process.spawn requires shell:true plus manual
// argument quoting to do that safely, which is exactly what
// cross-spawn already handles correctly on all three OSes. See
// cli/lib/platform.js for the reasoning on binary resolution.
const spawn = require('cross-spawn');
const { IS_WINDOWS, WHICH_CMD, resolveBin, OS_LABEL } = require('./platform');

const ROOT_DIR = path.join(__dirname, '..', '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
const BACKUPS_DIR = path.join(ROOT_DIR, 'backups');
const LOGS_DIR = path.join(ROOT_DIR, 'logs');
const PM2_BIN_DIR = path.join(BACKEND_DIR, 'node_modules', '.bin');
const PM2_BIN = resolveBin(PM2_BIN_DIR, 'pm2');

const colors = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', blue: '\x1b[34m', gray: '\x1b[90m',
};
function paint(c, s) { return process.stdout.isTTY ? `${colors[c]}${s}${colors.reset}` : s; }

// ---------------------------------------------------------------------------
// Shared run context (the 12 global flags every command supports — see
// cli/lib/flags.js). Set once by cli/rox.js before a handler runs, read by
// log.*, cli/lib/progress.js, and cli/lib/interactive.js so no individual
// command file has to thread flags through every function signature.
// ---------------------------------------------------------------------------
let CTX = { command: null, help: false, verbose: false, json: false, silent: false, force: false, yes: false, dryRun: false, fix: false, repair: false, debug: false, profile: false, timeout: 0 };
function setContext(patch) { Object.assign(CTX, patch); }
function getContext() { return CTX; }

// Every log line is also captured here (a) to build the single JSON blob
// --json prints at the end, and (b) to write cli/../logs/cli-<date>.log —
// "detailed logs" for every command, regardless of what's shown on screen.
const _buffer = [];
let _logStream = null;

function _logFilePath() {
  const d = new Date().toISOString().slice(0, 10);
  return path.join(LOGS_DIR, `cli-${d}.log`);
}
function _appendToLogFile(level, msg) {
  try {
    ensureDir(LOGS_DIR);
    if (!_logStream) _logStream = fs.createWriteStream(_logFilePath(), { flags: 'a' });
    _logStream.write(JSON.stringify({ ts: new Date().toISOString(), command: CTX.command, level, msg }) + '\n');
  } catch { /* logging must never crash the CLI */ }
}

function _emit(level, msg, { printWhen = true } = {}) {
  _buffer.push({ level, msg, ts: Date.now() });
  _appendToLogFile(level, msg);
  if (CTX.json) return; // buffered only — printed as one JSON blob at process exit
  if (!printWhen) return;
  if (CTX.silent && level !== 'err') return;
  return true;
}

const log = {
  info: (msg) => { if (_emit('info', msg)) console.log(`${paint('cyan', '›')} ${msg}`); },
  ok: (msg) => { if (_emit('ok', msg)) console.log(`${paint('green', '✓')} ${msg}`); },
  warn: (msg) => { if (_emit('warn', msg)) console.log(`${paint('yellow', '!')} ${msg}`); },
  err: (msg) => { _emit('err', msg); console.error(`${paint('red', '✗')} ${msg}`); }, // errors always shown, even in --silent
  step: (msg) => { if (_emit('step', msg)) console.log(`\n${paint('bold', msg)}`); },
  // Only shown with --verbose/--debug, but always captured to the file log.
  verbose: (msg) => { if (_emit('verbose', msg, { printWhen: CTX.verbose || CTX.debug })) console.log(`${paint('gray', '·')} ${msg}`); },
  debug: (msg) => { if (_emit('debug', msg, { printWhen: CTX.debug })) console.log(`${paint('magenta', 'debug')} ${msg}`); },
};

/** Prints the single JSON result object for --json mode. No-op otherwise. */
function flushJson(extra = {}) {
  if (!CTX.json) return;
  console.log(JSON.stringify({ ...extra, os: OS_LABEL, logs: _buffer }, null, CTX.silent ? 0 : 2));
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

/** Runs a command, streaming output live. Throws on non-zero exit. cross-spawn resolves .cmd/.bat/.ps1 shims correctly on Windows without needing shell:true (and its quoting bugs) from callers. */
function run(cmd, args, opts = {}) {
  const result = spawn.sync(cmd, args, { stdio: 'inherit', cwd: opts.cwd || BACKEND_DIR, env: { ...process.env, ...(opts.env || {}) } });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(`${cmd} not found on PATH (checked for ${OS_LABEL}). Is it installed?`);
    }
    throw result.error;
  }
  if (result.status !== 0 && !opts.allowFailure) {
    throw new Error(`${cmd} ${args.join(' ')} exited with code ${result.status}`);
  }
  return result.status;
}

/** Runs a command and returns stdout as a string, without printing it. */
function capture(cmd, args, opts = {}) {
  const result = spawn.sync(cmd, args, { cwd: opts.cwd || BACKEND_DIR, env: { ...process.env, ...(opts.env || {}) } });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(`${cmd} not found on PATH (checked for ${OS_LABEL}). Is it installed?`);
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with code ${result.status}`);
  }
  return (result.stdout || Buffer.alloc(0)).toString('utf8').trim();
}

/** Is `cmd` on PATH? Uses `where` on Windows, `which` elsewhere — see cli/lib/platform.js. */
function commandExists(cmd) {
  const result = spawn.sync(WHICH_CMD, [cmd]);
  return result.status === 0;
}

function pm2Available() {
  return fs.existsSync(PM2_BIN);
}

function pm2(args, opts = {}) {
  if (!pm2Available()) {
    throw new Error('pm2 is not installed yet. Run `rox setup` first.');
  }
  return run(PM2_BIN, args, opts);
}

/** Loads backend/.env into process.env for this CLI process (doesn't touch the actual file). */
function loadEnv() {
  const envPath = path.join(BACKEND_DIR, '.env');
  if (!fs.existsSync(envPath)) return {};
  const parsed = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    parsed[key] = value;
    if (!(key in process.env)) process.env[key] = value;
  }
  return parsed;
}

module.exports = {
  ROOT_DIR, BACKEND_DIR, BACKUPS_DIR, LOGS_DIR, PM2_BIN, PM2_BIN_DIR,
  IS_WINDOWS, OS_LABEL,
  log, run, capture, commandExists, pm2, pm2Available, loadEnv, ensureDir,
  paint, colors, setContext, getContext, flushJson,
};
