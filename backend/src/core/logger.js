// ROX AI — src/core/logger.js
//
// Deliberately dependency-free (no pino/winston) to keep the dependency
// count low per the project's own constraint. Structured JSON lines in
// production (so Railway/Render/any log drain can parse them without
// extra config); readable plain text in development.

const isProd = process.env.NODE_ENV === 'production';

function line(level, scope, message, meta) {
  if (isProd) {
    return JSON.stringify({ level, scope, message, ...meta, ts: new Date().toISOString() });
  }
  const suffix = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${scope}] ${message}${suffix}`;
}

function makeLogger(scope) {
  return {
    info: (message, meta) => console.log(line('info', scope, message, meta)),
    warn: (message, meta) => console.warn(line('warn', scope, message, meta)),
    error: (message, meta) => console.error(line('error', scope, message, meta)),
  };
}

module.exports = { makeLogger };
