// ROX AI — cli/commands/restore.js
//
// Restoring a database dump overwrites live data — this is the one
// command in the whole CLI that refuses to run without an explicit
// --yes, and stops both services first so nothing writes to the DB
// mid-restore.
//
// Usage: rox restore <path-to-backup.tar.gz> --yes [--no-env] [--skip-db]
//
// Extraction uses the `tar` npm package rather than shelling out to a
// system `tar` binary — see backup.js for why (Windows has no
// reliable built-in tar to depend on).

const fs = require('fs');
const path = require('path');
const os = require('os');
const tar = require('tar');
const { BACKEND_DIR, log, run, pm2, pm2Available, loadEnv, commandExists, getContext } = require('../lib/util');
const { installHint } = require('../lib/platform');
const { confirm } = require('../lib/interactive');

module.exports = async function restore(args) {
  const ctx = getContext();
  log.step('ROX AI — restore' + (ctx.dryRun ? ' [dry-run]' : ''));

  const archivePath = args.find((a) => !a.startsWith('--'));
  const skipEnv = args.includes('--no-env');
  const skipDb = args.includes('--skip-db');

  if (!archivePath) {
    log.err('Usage: rox restore <path-to-backup.tar.gz> --yes');
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(archivePath)) {
    log.err(`File not found: ${archivePath}`);
    process.exitCode = 1;
    return;
  }

  const confirmed = await confirm(`This will overwrite the live database and/or .env from ${archivePath}. Continue?`);
  if (!confirmed) {
    log.err('Not confirmed — pass --yes (or --force) to proceed. Nothing was touched.');
    process.exitCode = 1;
    return;
  }

  if (ctx.dryRun) {
    log.info(`--dry-run: would stop services, extract ${archivePath}, restore db.sql (unless --skip-db)/config/.env (unless --no-env), then restart services. Nothing was touched.`);
    return;
  }

  loadEnv();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rox-restore-'));
  await tar.extract({ file: path.resolve(archivePath), cwd: tmpDir });

  if (pm2Available()) {
    log.step('Stopping services before restore…');
    pm2(['stop', 'rox-api', 'rox-worker'], { allowFailure: true });
  }

  if (!skipDb) {
    const dbDump = path.join(tmpDir, 'db.sql');
    const dbUrl = process.env.SUPABASE_DB_URL;
    if (!fs.existsSync(dbDump)) {
      log.warn('No db.sql in this archive — skipping database restore.');
    } else if (!dbUrl) {
      log.warn('SUPABASE_DB_URL not set — cannot restore the database automatically. The dump is at ' + dbDump);
    } else if (!commandExists('psql')) {
      const hint = installHint('psql');
      log.warn(`psql not found on PATH — cannot restore the database automatically.${hint ? ` ${hint}` : ''}`);
    } else {
      log.step('Restoring database…');
      run('psql', ['-v', 'ON_ERROR_STOP=1', dbUrl, '-f', dbDump]);
      log.ok('Database restored.');
    }
  } else {
    log.info('--skip-db: database restore skipped.');
  }

  const configSrc = path.join(tmpDir, 'config');
  if (fs.existsSync(configSrc)) {
    const configDest = path.join(BACKEND_DIR, 'config');
    fs.mkdirSync(configDest, { recursive: true });
    for (const file of fs.readdirSync(configSrc)) {
      fs.copyFileSync(path.join(configSrc, file), path.join(configDest, file));
    }
    log.ok('Config files restored.');
  }

  const envSrc = path.join(tmpDir, 'env.backup');
  if (!skipEnv && fs.existsSync(envSrc)) {
    fs.copyFileSync(envSrc, path.join(BACKEND_DIR, '.env'));
    log.ok('.env restored.');
  } else if (fs.existsSync(envSrc)) {
    log.info('--no-env: .env in the archive was left untouched.');
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  if (pm2Available()) {
    log.step('Restarting services…');
    pm2(['start', 'ecosystem.config.js'], { allowFailure: true });
  }

  log.ok('Restore complete. Run `rox health` to confirm everything came back up.');
};
