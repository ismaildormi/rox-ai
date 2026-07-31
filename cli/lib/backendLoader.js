// ROX AI — cli/lib/backendLoader.js
//
// Generic version of the try/catch require pattern cli/commands/health.js
// originated (for diskMonitor) and cli/lib/aiBackend.js formalized for
// the AI subsystem. Pulled out on its own so non-AI command groups
// (queue, cron, server, ...) can use the same pattern without importing
// a file named "aiBackend" for something that isn't AI-related.

const path = require('path');
const { BACKEND_DIR } = require('./util');

/**
 * @param {string} relPath path relative to backend/, e.g. 'lib/queue' or 'src/modules/diskMonitor'
 * @returns {{ok: true, module: any} | {ok: false, error: Error}}
 */
function tryLoad(relPath) {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return { ok: true, module: require(path.join(BACKEND_DIR, relPath)) };
  } catch (err) {
    return { ok: false, error: err };
  }
}

module.exports = { tryLoad };
