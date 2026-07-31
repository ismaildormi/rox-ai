#!/usr/bin/env node
// ROX AI — cli/tests/test-production-deploy-config.js
//
// Structural/logic checks for the Production Deployment module
// (docker-compose.production.yml, scripts/deploy/production-deploy.sh,
// nginx/active.conf.template, .github/workflows/deploy-production.yml).
//
// Same category of test as test-cross-platform.js: this sandbox has
// no Docker daemon and no SSH-reachable host, so these are NOT a
// substitute for an actual deploy — they catch config mistakes
// (a service renamed, a placeholder removed, a required var dropped)
// that would otherwise only surface during a real run against a
// production host. `docker compose config` (needs the Docker CLI) and
// `shellcheck` (not installed in this sandbox either) remain the two
// deeper checks the workflow's own `validate` job performs on every
// run — see the "Could not verify in this environment" note this
// file's header format mirrors from the staging module's checkpoint.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

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

console.log('production deployment config checks');

const composePath = path.join(ROOT, 'docker-compose.production.yml');
const scriptPath = path.join(ROOT, 'scripts', 'deploy', 'production-deploy.sh');
const templatePath = path.join(ROOT, 'nginx', 'active.conf.template');
const workflowPath = path.join(ROOT, '.github', 'workflows', 'deploy-production.yml');

test('docker-compose.production.yml exists and defines both colors + nginx + worker + redis', () => {
  const text = fs.readFileSync(composePath, 'utf8');
  for (const svc of ['redis:', 'backend-blue:', 'backend-green:', 'nginx:', 'worker:']) {
    assert.ok(text.includes(`\n  ${svc}`), `expected service "${svc}" in docker-compose.production.yml`);
  }
});

test('backend-blue and backend-green expose distinct host ports (3011/3012) for direct health-checking', () => {
  const text = fs.readFileSync(composePath, 'utf8');
  assert.ok(text.includes("'3011:3001'"), 'expected backend-blue host port 3011');
  assert.ok(text.includes("'3012:3001'"), 'expected backend-green host port 3012');
});

test('nginx service mounts conf.d and publishes the public PORT', () => {
  const text = fs.readFileSync(composePath, 'utf8');
  assert.ok(text.includes('./nginx/conf.d:/etc/nginx/conf.d:ro'));
  assert.ok(text.includes("${PORT:-3001}:80"));
});

test('production-deploy.sh is valid bash syntax (bash -n)', () => {
  execFileSync('bash', ['-n', scriptPath], { stdio: 'pipe' });
});

test('production-deploy.sh requires IMAGE_TAG for a non-rollback deploy (no silent "latest" default)', () => {
  const text = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(/IMAGE_TAG="\$\{IMAGE_TAG:\?/.test(text), 'expected IMAGE_TAG to be a required var, not defaulted');
});

test('production-deploy.sh never stops the previously-active color (rollback stays instant)', () => {
  const text = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(!/docker compose[^\n]*(stop|rm)\b/.test(text), 'the old color must be left running for instant rollback');
});

test('production-deploy.sh health-checks the target color before any cutover', () => {
  const text = fs.readFileSync(scriptPath, 'utf8');
  const upIdx = text.indexOf('up -d --no-deps "backend-$target_color"');
  const healthIdx = text.indexOf('health_check_color "$target_color"');
  const cutoverIdx = text.indexOf('cut_over_to "$target_color"');
  assert.ok(upIdx > -1 && healthIdx > -1 && cutoverIdx > -1, 'expected all three steps to be present');
  assert.ok(upIdx < healthIdx && healthIdx < cutoverIdx, 'expected order: start target -> health-check target -> cut over');
});

test('nginx/active.conf.template has its substitution placeholder and proxies /healthz', () => {
  const text = fs.readFileSync(templatePath, 'utf8');
  assert.ok(text.includes('__ACTIVE_UPSTREAM__'));
  assert.ok(text.includes('location /healthz'));
});

test('deploy-production.yml is only manually triggered (no workflow_run auto-trigger like staging)', () => {
  const text = fs.readFileSync(workflowPath, 'utf8');
  assert.ok(text.includes('workflow_dispatch:'));
  assert.ok(!text.includes('workflow_run:'), 'production must not auto-deploy the way staging does');
});

test('deploy-production.yml gates the deploy job behind the "production" GitHub Environment', () => {
  const text = fs.readFileSync(workflowPath, 'utf8');
  assert.ok(/environment:\s*production/.test(text));
});

test('deploy-production.yml requires image_tag unless rollback is true', () => {
  const text = fs.readFileSync(workflowPath, 'utf8');
  assert.ok(text.includes("inputs.rollback != true && inputs.image_tag == ''"));
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) {
  console.error('SOME TESTS FAILED.');
}
