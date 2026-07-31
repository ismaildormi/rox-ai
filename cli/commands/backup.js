// ROX AI — cli/commands/backup.js
//
// One archive per backup: backups/rox-backup-<timestamp>.tar.gz,
// containing:
//   - db.sql            (pg_dump of the whole Supabase Postgres DB —
//                         the actual source of truth: credits, users,
//                         subscriptions, generation jobs, advisor data)
//   - config/            (backend/config/*.json — plans, models,
//                         feature flags, advisor/optimizer thresholds)
//   - env.backup         (backend/.env — see the warning below)
//
// Redis is deliberately NOT backed up: everything in it (BullMQ queue
// state, rate-limit counters, model circuit-breaker state) is
// operational and regenerable — losing it costs a few seconds of
// queue replay at worst, never a fact about the business. Backing up
// the wrong thing (Redis) instead of the right thing (Postgres) is a
// classic and avoidable mistake.
//
// env.backup contains real secrets (API keys, service role key) —
// this file is chmod 600 on write where the OS honors that (POSIX;
// it's a harmless no-op on Windows, which has no chmod-bit model —
// NTFS permissions are ACL-based instead, so a Windows deployment
// should rely on filesystem/folder permissions for this file), and
// restoring it always requires an explicit --yes on `rox restore`
// (see restore.js). Fine for a solo/small-team deployment; a larger
// team should route secrets through a real secrets manager instead
// and skip env.backup with --no-env.
//
// The archive itself is built with the `tar` npm package (pure JS,
// same behavior on every OS) instead of shelling out to a system
// `tar` binary — Windows only ships a real tar.exe on builds from
// 2018 onward (and even then it's a different bsdtar with its own
// quirks), so relying on it broke this command there entirely.

const fs = require('fs');
const path = require('path');
const tar = require('tar');
const { BACKEND_DIR, BACKUPS_DIR, log, ensureDir, loadEnv, commandExists, run } = require('../lib/util');
const { IS_WINDOWS, installHint } = require('../lib/platform');
const { createProgressBar } = require('../lib/progress');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** chmod is a POSIX permission-bits call; Windows has no equivalent concept (ACLs instead), so fs.chmodSync there is a documented no-op. Skip it explicitly rather than let it silently do nothing. */
function chmodSecretsFile(filePath) {
  if (IS_WINDOWS) return;
  fs.chmodSync(filePath, 0o600);
}

module.exports = async function backup(args) {
  log.step('ROX AI — backup');
  loadEnv();
  ensureDir(BACKUPS_DIR);

  const includeEnv = !args.includes('--no-env');
  const ts = timestamp();
  const stagingDir = path.join(BACKUPS_DIR, `.staging-${ts}`);
  ensureDir(stagingDir);
  ensureDir(path.join(stagingDir, 'config'));

  const progress = createProgressBar({ total: 4, label: 'backup' });

  let dbDumped = false;
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (dbUrl) {
    if (!commandExists('pg_dump')) {
      const hint = installHint('pg_dump');
      log.warn(`pg_dump not found on PATH — skipping database dump.${hint ? ` ${hint}` : ' Install postgresql-client to enable this.'}`);
    } else {
      log.step('Dumping database…');
      run('pg_dump', ['--no-owner', '--no-privileges', '-f', path.join(stagingDir, 'db.sql'), dbUrl], { allowFailure: true });
      dbDumped = fs.existsSync(path.join(stagingDir, 'db.sql'));
      if (dbDumped) log.ok('Database dumped.');
      else log.err('pg_dump ran but produced no output — check the connection string.');
    }
  } else {
    log.warn('SUPABASE_DB_URL not set — skipping database dump. Set it in .env, or rely on Supabase\'s own managed backups for now.');
  }
  progress.tick();

  const configDir = path.join(BACKEND_DIR, 'config');
  if (fs.existsSync(configDir)) {
    for (const file of fs.readdirSync(configDir)) {
      fs.copyFileSync(path.join(configDir, file), path.join(stagingDir, 'config', file));
    }
    log.ok('Config files copied.');
  }
  progress.tick();

  if (includeEnv) {
    const envPath = path.join(BACKEND_DIR, '.env');
    if (fs.existsSync(envPath)) {
      const dest = path.join(stagingDir, 'env.backup');
      fs.copyFileSync(envPath, dest);
      chmodSecretsFile(dest);
      log.ok(`.env copied (contains secrets${IS_WINDOWS ? '' : ' — archive will be chmod 600'}).`);
    }
  } else {
    log.info('.env excluded (--no-env).');
  }
  progress.tick();

  if (!dbDumped && !fs.existsSync(path.join(configDir))) {
    log.err('Nothing to back up — aborting.');
    fs.rmSync(stagingDir, { recursive: true, force: true });
    process.exitCode = 1;
    return;
  }

  const archiveName = `rox-backup-${ts}.tar.gz`;
  const archivePath = path.join(BACKUPS_DIR, archiveName);
  await tar.create({ gzip: true, file: archivePath, cwd: stagingDir }, ['.']);
  chmodSecretsFile(archivePath);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  progress.finish(`Backup written: backups/${archiveName}`);
  if (!dbUrl) log.warn('Reminder: no database was included in this backup (see above).');
};
