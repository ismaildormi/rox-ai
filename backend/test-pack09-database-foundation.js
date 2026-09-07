'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname, '36_zuvyr_workspace_foundation.sql'), 'utf8');
const tables = ['workspace_projects','workspace_items','workspace_project_items','workspace_creations','workspace_templates','workspace_workflows','workspace_workflow_steps','workspace_schedules','workspace_plugin_connections','workspace_integration_connections','workspace_audit_events'];
for (const table of tables) {
  assert(sql.includes(`create table if not exists public.${table}`), `Missing table ${table}`);
  assert(sql.includes(`alter table public.${table} enable row level security`), `Missing RLS ${table}`);
}
for (const constraint of ['external_sharing_enabled = false','generated = false','external_exported = false','scripts_allowed = false','community_published = false','execution_enabled = false','external_writes_enabled = false','installed = false','runtime_enabled = false','connected = false','read_enabled = false','write_enabled = false','external_write_executed = false']) assert(sql.includes(constraint), `Missing fail-closed constraint ${constraint}`);
assert(!/(access_token|refresh_token|oauth_token|client_secret|api_key)/i.test(sql));
assert(sql.includes('revoke all on public.workspace_projects'));
assert(!/drop\s+(table|column)|truncate|delete\s+from/i.test(sql));
console.log('PASS: Pack 09 additive RLS Workspace schema stores no credentials and constrains all execution false');
