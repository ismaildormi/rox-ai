#!/usr/bin/env node
// ROX AI — backend/scripts/migrate.js
//
// Applies every NN_*.sql file in backend/ against SUPABASE_DB_URL, in
// numeric order, skipping ones already applied. This is what lets
// `rox update` be "one command" even when a release adds a new
// numbered .sql file — no manual trip to the Supabase SQL Editor.
//
// Requires `psql` on PATH (part of the postgresql-client package —
// `apt install postgresql-client` / `brew install libpq`) and
// SUPABASE_DB_URL in .env: Supabase dashboard -> Project Settings ->
// Database -> Connection string (URI, "Session pooler" or direct —
// either works for one-shot migration runs; use the session pooler
// one if your network blocks direct Postgres connections).
//
// Deliberately NOT a JS Postgres client dependency: every migration
// file already IS a .sql file meant to be run by psql (see each file's
// own header comments) — shelling out runs the exact same statements
// the README always told you to paste into the SQL Editor, just
// automated, not reimplemented against a different driver.

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.join(__dirname, '..');

function log(msg) { console.log(`[migrate] ${msg}`); }
function fail(msg) { console.error(`[migrate] ERROR: ${msg}`); process.exit(1); }

function listMigrationFiles() {
  return fs
    .readdirSync(BACKEND_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a) - parseInt(b));
}

function psql(dbUrl, sqlOrArgs, { captureOutput = false } = {}) {
  const args = ['-v', 'ON_ERROR_STOP=1', dbUrl, ...sqlOrArgs];
  const opts = { stdio: captureOutput ? ['ignore', 'pipe', 'inherit'] : 'inherit' };
  const result = execFileSync('psql', args, opts);
  return captureOutput ? result.toString('utf8') : null;
}

function ensureTrackingTable(dbUrl) {
  psql(dbUrl, [
    '-c',
    `create table if not exists schema_migrations (
       filename text primary key,
       applied_at timestamptz not null default now()
     );`,
  ]);
}

function getAppliedFiles(dbUrl) {
  const out = psql(dbUrl, ['-tAc', 'select filename from schema_migrations order by filename;'], { captureOutput: true });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function markApplied(dbUrl, filename) {
  psql(dbUrl, ['-c', `insert into schema_migrations (filename) values ('${filename}') on conflict do nothing;`]);
}

function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    log('SUPABASE_DB_URL is not set — skipping schema migration.');
    log('Apply the .sql files manually in Supabase SQL Editor (numeric order), or set');
    log('SUPABASE_DB_URL in .env to let this run automatically next time.');
    process.exit(0); // not a failure — this is an optional, additive step
  }

  try {
    execSync('psql --version', { stdio: 'ignore' });
  } catch {
    fail('psql not found on PATH. Install postgresql-client, or run the .sql files manually.');
  }

  log('Checking schema_migrations…');
  ensureTrackingTable(dbUrl);
  const applied = new Set(getAppliedFiles(dbUrl));
  const all = listMigrationFiles();
  const pending = all.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    log('Schema already up to date — nothing to apply.');
    return;
  }

  log(`Applying ${pending.length} migration(s): ${pending.join(', ')}`);
  for (const file of pending) {
    log(`→ ${file}`);
    psql(dbUrl, ['-f', path.join(BACKEND_DIR, file)]);
    markApplied(dbUrl, file);
  }
  log('Done.');
}

main();
