#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

const required = [
  'VERSION.json',
  'ROX-MANAGER.ps1', 'ROX-MANAGER.cmd',
  'ROX-SETUP.ps1', 'ROX-SETUP.cmd',
  'ROX-CONFIGURE.ps1', 'ROX-START.ps1', 'ROX-STOP.ps1', 'ROX-RESTART.ps1',
  'ROX-HEALTH.ps1', 'ROX-TEST.ps1', 'ROX-BACKUP.ps1', 'ROX-RESTORE.ps1',
  'ROX-UPDATE.ps1', 'ROX-ROLLBACK.ps1', 'ROX-SUPABASE.ps1', 'ROX-STRIPE.ps1',
  'ROX-DEPLOY.ps1', 'ROX-SUPPORT.ps1', 'ROX-SHORTCUT.ps1',
  'ROX-PROFILE.ps1', 'ROX-BRIDGE.ps1', 'ROX-VERIFY-LIVE.ps1', 'ROX-SMOKE.ps1', 'ROX-STAGING.ps1', 'ROX-PREFLIGHT.ps1',
  'scripts/windows/ROX.Common.ps1',
  'tools/serve-frontend.js',
  'frontend/rox-config.js', 'frontend/rox-config.example.js', 'frontend/rox-release-guard.js',
];

let failures = 0;
function ok(condition, message) {
  if (condition) console.log(`PASS ${message}`);
  else { console.error(`FAIL ${message}`); failures += 1; }
}

for (const rel of required) ok(fs.existsSync(path.join(root, rel)), `exists: ${rel}`);

const index = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
ok((index.match(/\.\/rox-config\.js/g) || []).length === 2, 'runtime config loaded by mobile and desktop');
ok((index.match(/window\.ROX_RUNTIME_CONFIG\?\./g) || []).length >= 6, 'both CONFIG blocks use runtime overrides');

const publicConfig = fs.readFileSync(path.join(root, 'frontend/rox-config.js'), 'utf8');
ok(!/SERVICE_ROLE|STRIPE_SECRET|OPENROUTER_API|REPLICATE_API_TOKEN|FAL_KEY/.test(publicConfig), 'public config contains no server secret names');

const manager = fs.readFileSync(path.join(root, 'ROX-MANAGER.ps1'), 'utf8');
for (const rel of required.filter((x) => /^ROX-.*\.ps1$/.test(x))) {
  if (rel === 'ROX-MANAGER.ps1' || rel === 'ROX-PREFLIGHT.ps1') continue;
  ok(manager.includes(rel), `manager references ${rel}`);
}

const update = fs.readFileSync(path.join(root, 'ROX-UPDATE.ps1'), 'utf8');
ok(update.includes('$preservedEnv') && update.includes('$preservedFrontendConfig'), 'safe update preserves local secrets/public runtime config');
ok(update.includes('Automatic rollback') && update.includes('ROX-TEST.ps1'), 'safe update validates and rolls back');

const support = fs.readFileSync(path.join(root, 'ROX-SUPPORT.ps1'), 'utf8');
ok(/redacted-secret|environment-redacted/.test(support), 'support report redacts secrets');

for (const rel of required.filter((x) => x.endsWith('.ps1'))) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  ok(!text.includes('\u0000'), `${rel} has no NUL bytes`);
  ok((text.match(/\{/g) || []).length === (text.match(/\}/g) || []).length, `${rel} has balanced braces (static check)`);
  ok((text.match(/\(/g) || []).length === (text.match(/\)/g) || []).length, `${rel} has balanced parentheses (static check)`);
  ok((text.match(/\[/g) || []).length === (text.match(/\]/g) || []).length, `${rel} has balanced brackets (static check)`);
  ok((text.match(/=\s*@['\"]\s*$/gm) || []).length === (text.match(/^\s*['\"]@\s*$/gm) || []).length, `${rel} has paired here-strings (static check)`);
}

if (failures) {
  console.error(`\n${failures} Windows automation check(s) failed.`);
  process.exit(1);
}
console.log('\nAll Windows automation static checks passed.');
