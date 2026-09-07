'use strict';

const { config } = require('./codeStudioRegistry');
const { normalizeCodeProject, contractError } = require('./codeProjectContract');

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function extension(path) {
  const match = String(path).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function buildSafePreview(projectInput) {
  const project = normalizeCodeProject(projectInput);
  const entryFile = project.entryFile || config.preview.entryFile;
  const entry = project.files.find(file => file.path.toLowerCase() === entryFile.toLowerCase());
  if (!entry) throw contractError('code_preview_entry_missing', entryFile);
  const ext = extension(entry.path);
  if (!config.preview.allowedExtensions.includes(ext)) throw contractError('code_preview_extension_blocked', ext);

  const csp = `<meta http-equiv="Content-Security-Policy" content="${config.preview.contentSecurityPolicy}">`;
  const document = ext === 'html'
    ? (/<head[\s>]/i.test(entry.content)
        ? entry.content.replace(/<head([^>]*)>/i, `<head$1>${csp}`)
        : `<!doctype html><html><head>${csp}</head><body>${entry.content}</body></html>`)
    : `<!doctype html><html><head>${csp}</head><body><pre>${escapeHtml(entry.content)}</pre></body></html>`;
  return Object.freeze({
    entryFile: entry.path,
    srcdoc: document,
    sandbox: config.preview.sandboxTokens.join(' '),
    networkEnabled: false
  });
}

module.exports = { buildSafePreview };
