// ROX AI — cli/lib/platform.js
//
// Single source of truth for "which OS am I on and how do I talk to
// it correctly" — every other file (util.js, setup.js, backup.js...)
// should import from here rather than checking process.platform
// inline, so there's exactly one place that knows the differences
// between Windows/macOS/Linux instead of that knowledge being
// scattered across command files.

const os = require('os');
const fs = require('fs');
const path = require('path');

const PLATFORM = process.platform; // 'win32' | 'darwin' | 'linux' | ...
const IS_WINDOWS = PLATFORM === 'win32';
const IS_MAC = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

const OS_LABEL = IS_WINDOWS ? 'Windows' : IS_MAC ? 'macOS' : IS_LINUX ? 'Linux' : PLATFORM;

/**
 * Resolve the actual executable for an npm-installed CLI tool that
 * lives in some package's node_modules/.bin. On POSIX this is just
 * `<binDir>/<name>`. On Windows, npm never writes a plain extension-
 * less file there — it writes `<name>.cmd` (cmd.exe shim), `<name>.ps1`
 * (PowerShell shim), and a POSIX shell shim also literally named
 * `<name>` (which Windows can't execute). Node's child_process will
 * not find the tool at all if you hand it the extension-less path on
 * Windows, so every caller that used to do
 * `path.join(binDir, 'pm2')` needs this instead.
 */
function resolveBin(binDir, name) {
  if (!IS_WINDOWS) return path.join(binDir, name);
  const cmdPath = path.join(binDir, `${name}.cmd`);
  if (fs.existsSync(cmdPath)) return cmdPath;
  const exePath = path.join(binDir, `${name}.exe`);
  if (fs.existsSync(exePath)) return exePath;
  // Fall back to the extension-less name so error messages still make
  // sense ("X not found") instead of silently resolving to nothing.
  return path.join(binDir, name);
}

/** True if `binPath` needs to run through a shell to execute on this OS (Windows .cmd/.bat shims can't be exec'd directly). */
function needsShell(binPath) {
  if (!IS_WINDOWS) return false;
  const ext = path.extname(binPath).toLowerCase();
  return ext === '.cmd' || ext === '.bat';
}

/** The tool used to check "is this on PATH" — `where` on Windows, `which` everywhere else. */
const WHICH_CMD = IS_WINDOWS ? 'where' : 'which';

/** Human-readable, OS-specific install/setup hints for tools the CLI shells out to. Used in warnings so the fix is always actionable, not just "not found." */
const INSTALL_HINTS = {
  docker: {
    win32: 'Install Docker Desktop for Windows (uses WSL2): https://docs.docker.com/desktop/install/windows-install/',
    darwin: 'Install Docker Desktop for Mac: https://docs.docker.com/desktop/install/mac-install/, or `brew install --cask docker`.',
    linux: 'Install Docker Engine: https://docs.docker.com/engine/install/, or your distro\'s docker/docker.io package.',
  },
  pg_dump: {
    win32: 'Install PostgreSQL client tools: `winget install PostgreSQL.PostgreSQL` (or the full installer from postgresql.org), then ensure its bin/ directory is on PATH.',
    darwin: '`brew install postgresql` gives you pg_dump, or `brew install libpq` for just the client tools.',
    linux: 'Install the postgresql-client package for your distro (e.g. `apt install postgresql-client`).',
  },
  psql: {
    win32: 'Install PostgreSQL client tools: `winget install PostgreSQL.PostgreSQL` (or the full installer from postgresql.org), then ensure its bin/ directory is on PATH.',
    darwin: '`brew install postgresql` gives you psql, or `brew install libpq` for just the client tools.',
    linux: 'Install the postgresql-client package for your distro (e.g. `apt install postgresql-client`).',
  },
};

function installHint(tool) {
  const perOs = INSTALL_HINTS[tool];
  if (!perOs) return null;
  return perOs[PLATFORM] || perOs.linux;
}

module.exports = {
  PLATFORM,
  OS_LABEL,
  IS_WINDOWS,
  IS_MAC,
  IS_LINUX,
  WHICH_CMD,
  resolveBin,
  needsShell,
  installHint,
  cpuArch: os.arch(),
};
