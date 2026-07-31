#!/usr/bin/env node
// ROX AI — cli/tests/test-cross-platform.js
//
// This sandbox only has a Linux runner available, so these tests
// can't launch a real Windows process — what they CAN do is verify
// the platform-resolution *logic* itself by forcing process.platform
// to 'win32' and re-requiring cli/lib/platform.js fresh (its exports
// are computed once at module-load time from process.platform, so a
// clean require.cache entry per platform is required for this to
// actually exercise the Windows branch instead of whatever OS this
// happens to run on).
//
// This is a logic check, not a substitute for running `rox` on a real
// Windows machine — anyone shipping a change to cli/lib/platform.js
// should still confirm setup/start/stop/health/backup/restore against
// an actual Windows install before calling it verified there.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err.stack}`);
    process.exitCode = 1;
  }
}

/** Re-requires cli/lib/platform.js as if running on `platformValue`. */
function loadPlatformAs(platformValue) {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platformValue });
  delete require.cache[require.resolve('../lib/platform')];
  try {
    return require('../lib/platform');
  } finally {
    Object.defineProperty(process, 'platform', realPlatform);
  }
}

console.log('cross-platform resolution logic');

test('IS_WINDOWS/IS_MAC/IS_LINUX reflect process.platform correctly', () => {
  const win = loadPlatformAs('win32');
  assert.strictEqual(win.IS_WINDOWS, true);
  assert.strictEqual(win.IS_MAC, false);
  assert.strictEqual(win.OS_LABEL, 'Windows');

  const mac = loadPlatformAs('darwin');
  assert.strictEqual(mac.IS_MAC, true);
  assert.strictEqual(mac.IS_WINDOWS, false);
  assert.strictEqual(mac.OS_LABEL, 'macOS');

  const linux = loadPlatformAs('linux');
  assert.strictEqual(linux.IS_LINUX, true);
  assert.strictEqual(linux.IS_WINDOWS, false);
  assert.strictEqual(linux.OS_LABEL, 'Linux');
});

test('WHICH_CMD is `where` on Windows, `which` elsewhere', () => {
  assert.strictEqual(loadPlatformAs('win32').WHICH_CMD, 'where');
  assert.strictEqual(loadPlatformAs('darwin').WHICH_CMD, 'which');
  assert.strictEqual(loadPlatformAs('linux').WHICH_CMD, 'which');
});

test('resolveBin finds the .cmd shim on Windows (the actual bug this fixes: node_modules/.bin/pm2 has no extension-less file on Windows)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rox-bin-'));
  fs.writeFileSync(path.join(tmpDir, 'pm2.cmd'), '@echo off');
  const win = loadPlatformAs('win32');
  const resolved = win.resolveBin(tmpDir, 'pm2');
  assert.strictEqual(resolved, path.join(tmpDir, 'pm2.cmd'));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveBin falls back to .exe on Windows when no .cmd is present', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rox-bin-'));
  fs.writeFileSync(path.join(tmpDir, 'pm2.exe'), '');
  const win = loadPlatformAs('win32');
  const resolved = win.resolveBin(tmpDir, 'pm2');
  assert.strictEqual(resolved, path.join(tmpDir, 'pm2.exe'));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveBin on POSIX just joins the plain name (no .cmd/.exe hunting)', () => {
  const linux = loadPlatformAs('linux');
  assert.strictEqual(linux.resolveBin('/some/bin', 'pm2'), path.join('/some/bin', 'pm2'));
});

test('needsShell is true only for .cmd/.bat on Windows, never on POSIX', () => {
  const win = loadPlatformAs('win32');
  assert.strictEqual(win.needsShell('C:\\x\\pm2.cmd'), true);
  assert.strictEqual(win.needsShell('C:\\x\\pm2.bat'), true);
  assert.strictEqual(win.needsShell('C:\\x\\pm2.exe'), false);

  const linux = loadPlatformAs('linux');
  assert.strictEqual(linux.needsShell('/x/pm2.cmd'), false); // no such thing as a POSIX shell shim requirement
});

test('installHint returns an OS-specific string for known tools and null for unknown ones', () => {
  const win = loadPlatformAs('win32');
  assert.ok(win.installHint('docker').includes('Docker Desktop'));
  assert.strictEqual(win.installHint('not-a-real-tool'), null);

  const mac = loadPlatformAs('darwin');
  assert.ok(mac.installHint('pg_dump').toLowerCase().includes('brew'));
});

test('PM2_BIN in cli/lib/util.js resolves via resolveBin, not a hardcoded extension-less path', () => {
  const { PM2_BIN, PM2_BIN_DIR } = require('../lib/util');
  assert.ok(PM2_BIN.startsWith(PM2_BIN_DIR));
});

test('root package.json scripts invoke rox.js via `node`, never rely on the shebang (Windows does not process #!/usr/bin/env node at all)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    if (cmd.includes('rox.js')) {
      assert.ok(cmd.trim().startsWith('node '), `script "${name}" should invoke rox.js via "node", got: ${cmd}`);
    }
  }
});

test('backend/lib/diskScan.js no longer shells out to df/du/command -v (all POSIX-only)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'lib', 'diskScan.js'), 'utf8');
  assert.ok(!/execFileSync\(['"]df['"]/.test(src), 'still shells out to df');
  assert.ok(!/execFileSync\(['"]du['"]/.test(src), 'still shells out to du');
  assert.ok(!/execSync\(`command -v/.test(src), 'still invokes the POSIX-only `command -v` builtin');
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.error('SOME TESTS FAILED');
  process.exit(1);
}
