'use strict';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'https://rox-ai-sepia.vercel.app',
];

const DEFAULT_ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'X-Metrics-Token',
];

const DEFAULT_ALLOWED_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
];

function parseAllowedOrigins(value = process.env.ALLOWED_ORIGINS) {
  return new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...String(value || '')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean),
  ]);
}

function appendVary(res, value) {
  const current = res.getHeader('Vary');
  const values = String(current || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  if (!values.includes(value)) {
    values.push(value);
  }

  res.setHeader('Vary', values.join(', '));
}

function createCorsMiddleware(options = {}) {
  const allowedOrigins = options.allowedOrigins || parseAllowedOrigins();
  const allowedHeaders = options.allowedHeaders || DEFAULT_ALLOWED_HEADERS;
  const allowedMethods = options.allowedMethods || DEFAULT_ALLOWED_METHODS;
  const maxAgeSeconds = Number(options.maxAgeSeconds || 600);

  return function roxCors(req, res, next) {
    const origin = req.headers.origin;

    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', allowedHeaders.join(', '));
      res.setHeader('Access-Control-Allow-Methods', allowedMethods.join(', '));
      res.setHeader('Access-Control-Max-Age', String(maxAgeSeconds));
      appendVary(res, 'Origin');
    }

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    return next();
  };
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_ALLOWED_HEADERS,
  DEFAULT_ALLOWED_METHODS,
  parseAllowedOrigins,
  createCorsMiddleware,
};
