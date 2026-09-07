'use strict';

const crypto = require('node:crypto');
const { config } = require('./codeStudioRegistry');

function contractError(code, detail) {
  const error = new Error(code);
  error.code = code;
  if (detail !== undefined) error.detail = detail;
  return error;
}

function normalizeProjectPath(value) {
  const original = String(value || '').trim();
  if (!original) throw contractError('code_file_path_required');
  if (original.length > config.projectLimits.maxPathCharacters) throw contractError('code_file_path_too_long');
  if (/\0|[\u0000-\u001f\u007f]/.test(original)) throw contractError('code_file_path_control_character');
  if (/%(?:2e|2f|5c)/i.test(original)) throw contractError('code_file_path_encoded_traversal');
  if (/^[a-zA-Z]:[\\/]/.test(original) || /^[\\/]{1,2}/.test(original)) throw contractError('code_file_absolute_path');

  const normalized = original.replace(/\\/g, '/').replace(/\/+/g, '/');
  const segments = normalized.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) throw contractError('code_file_path_traversal');
  if (segments.some(segment => config.blockedPathSegments.includes(segment.toLowerCase()))) throw contractError('code_file_blocked_path');

  const baseName = segments[segments.length - 1].toLowerCase();
  if (config.blockedFileNames.includes(baseName) || baseName.startsWith('.env.')) throw contractError('code_file_secret_name');
  return normalized;
}

function normalizeCodeFile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw contractError('invalid_code_file');
  const path = normalizeProjectPath(value.path);
  if (typeof value.content !== 'string') throw contractError('code_file_content_required', path);
  const bytes = Buffer.byteLength(value.content, 'utf8');
  if (bytes > config.projectLimits.maxFileBytes) throw contractError('code_file_too_large', path);
  return Object.freeze({
    path,
    content: value.content,
    language: typeof value.language === 'string' ? value.language.trim().toLowerCase().slice(0, 40) : null,
    bytes,
    sha256: crypto.createHash('sha256').update(value.content, 'utf8').digest('hex')
  });
}

function normalizeCodeProject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw contractError('invalid_code_project');
  const name = String(value.name || '').trim();
  if (!name || name.length > config.projectLimits.maxProjectNameCharacters) throw contractError('invalid_code_project_name');
  if (!Array.isArray(value.files) || value.files.length < 1) throw contractError('code_project_files_required');
  if (value.files.length > config.projectLimits.maxFiles) throw contractError('code_project_too_many_files');

  const files = value.files.map(normalizeCodeFile);
  const seen = new Set();
  let totalBytes = 0;
  for (const file of files) {
    const identity = file.path.toLowerCase();
    if (seen.has(identity)) throw contractError('duplicate_code_file_path', file.path);
    seen.add(identity);
    totalBytes += file.bytes;
  }
  if (totalBytes > config.projectLimits.maxProjectBytes) throw contractError('code_project_too_large');

  const entryFile = value.entryFile ? normalizeProjectPath(value.entryFile) : null;
  if (entryFile && !seen.has(entryFile.toLowerCase())) throw contractError('code_project_entry_missing', entryFile);
  return Object.freeze({ name, entryFile, files: Object.freeze(files), totalBytes });
}

module.exports = { contractError, normalizeProjectPath, normalizeCodeFile, normalizeCodeProject };
