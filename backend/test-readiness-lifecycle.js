'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

const required = [
  "let shuttingDown = false;",
  "app.get('/livez'",
  "status: 'alive'",
  "app.get('/readyz'",
  "reason: 'shutting_down'",
  "const queueDepthInterval = setInterval(reportQueueDepths, 10_000);",
  "const server = app.listen(",
  "const SHUTDOWN_TIMEOUT_MS = 10_000;",
  "function beginGracefulShutdown(signal)",
  "server.close(() =>",
  "process.on('SIGTERM'",
  "process.on('SIGINT'",
];

for (const marker of required) {
  if (!source.includes(marker)) {
    throw new Error(`lifecycle marker missing: ${marker}`);
  }
}

for (const [route, expected] of [
  ["/healthz", 1],
  ["/readyz", 1],
  ["/livez", 1],
]) {
  const re = new RegExp(`app\\.get\\('${route.replace('/', '\\/')}'`, 'g');
  const count = (source.match(re) || []).length;
  if (count !== expected) {
    throw new Error(`expected ${expected} ${route} route, found ${count}`);
  }
}

console.log('PASS: Pack 006 liveness + graceful shutdown wiring verified.');