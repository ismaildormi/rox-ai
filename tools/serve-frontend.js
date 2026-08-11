#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const root = path.resolve(__dirname, '..', 'frontend');
const port = Number(process.env.ROX_FRONTEND_PORT || process.argv[2] || 5500);
const host = process.env.ROX_FRONTEND_HOST || '127.0.0.1';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function safeFile(requestUrl) {
  const parsed = new URL(requestUrl, `http://${host}:${port}`);
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname === '/') pathname = '/index.html';
  const resolved = path.resolve(root, `.${pathname}`);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  const file = safeFile(req.url || '/');
  if (!file) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(file, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' || path.basename(file) === 'rox-config.js'
        ? 'no-store, max-age=0'
        : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };

    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
});

server.on('error', (err) => {
  console.error(`[rox-frontend] ${err.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`[rox-frontend] serving ${root}`);
  console.log(`[rox-frontend] http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`[rox-frontend] ${signal} received; stopping`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
