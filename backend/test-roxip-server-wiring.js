'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(
  path.join(__dirname, 'server.js'),
  'utf8'
);

function count(text) {
  return server.split(text).length - 1;
}

assert.strictEqual(
  count("require('./lib/roxIpRoutes')"),
  1,
  'Server must import the Rox IP router once.'
);

assert.strictEqual(
  count("'/api/roxip'"),
  1,
  'Server must mount the Rox IP API once.'
);

const mount = [
  "app.use(",
  "  '/api/roxip',",
  "  requireAuth,",
  "  rateLimit('roxip'),",
  "  createRoxIpRouter()",
  ");"
].join('\n');

assert(
  server.includes(mount),
  'Rox IP route must use auth, per-user rate limiting and its dedicated router.'
);

const mountStart = server.indexOf("  '/api/roxip',");
const authPosition = server.indexOf(
  '  requireAuth,',
  mountStart
);
const ratePosition = server.indexOf(
  "  rateLimit('roxip'),",
  mountStart
);
const routerPosition = server.indexOf(
  '  createRoxIpRouter()',
  mountStart
);

assert(
  mountStart >= 0 &&
    authPosition > mountStart &&
    ratePosition > authPosition &&
    routerPosition > ratePosition,
  'Rox IP middleware order must be requireAuth then rateLimit then router.'
);

assert.strictEqual(
  count("app.post('/api/chat'"),
  1,
  'Existing chat route must remain present once.'
);

assert.strictEqual(
  count("app.post('/api/generate-image'"),
  1,
  'Existing image route must remain present once.'
);

assert.strictEqual(
  count("app.post('/api/generate-video'"),
  1,
  'Existing video route must remain present once.'
);

assert.strictEqual(
  count("'/api/conversations'"),
  1,
  'Existing conversation API mount must remain present once.'
);

console.log(
  'PASS: authenticated Rox IP server wiring tests'
);