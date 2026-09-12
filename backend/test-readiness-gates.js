'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

const required = [
  "async function checkHardDependencies()",
  "app.get('/healthz'",
  "app.get('/readyz'",
  "queueConnection.ping()",
  "process.env.SUPABASE_URL",
  "process.env.SUPABASE_SERVICE_ROLE_KEY",
  "res.status(ready ? 200 : 503)",
  "status: ready ? 'ready' : 'not_ready'",
];

for (const marker of required) {
  if (!source.includes(marker)) {
    throw new Error(`readiness marker missing: ${marker}`);
  }
}

const healthCount = (source.match(/app\.get\('\/healthz'/g) || []).length;
const readyCount = (source.match(/app\.get\('\/readyz'/g) || []).length;

if (healthCount !== 1) throw new Error(`expected one /healthz route, found ${healthCount}`);
if (readyCount !== 1) throw new Error(`expected one /readyz route, found ${readyCount}`);

console.log('PASS: Pack 006 readiness wiring verified.');