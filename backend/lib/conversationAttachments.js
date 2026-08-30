'use strict';

const path = require('path');

const ATTACHMENT_BUCKET = 'conversation-files';
const MAX_ATTACHMENT_BYTES = 600 * 1024 * 1024;
const MAX_ATTACHMENT_NAME_LENGTH = 180;

const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.msi',
  '.com',
  '.scr',
  '.pif',
  '.cpl',
  '.sys',
  '.drv',
  '.ocx',
  '.lnk',
  '.reg',
  '.app',
  '.dmg',
  '.pkg',
  '.deb',
  '.rpm',
  '.apk',
  '.ipa',
  '.jar',
  '.war',
  '.ear',
  '.iso',
  '.img',
  '.vhd',
  '.vhdx',
  '.docm',
  '.dotm',
  '.xlsm',
  '.xlam',
  '.pptm',
  '.potm',
  '.ppam'
]);

const BLOCKED_MIME_TYPES = new Set([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/vnd.microsoft.portable-executable',
  'application/x-msi',
  'application/java-archive',
  'application/vnd.android.package-archive',
  'application/x-apple-diskimage',
  'application/x-dosexec'
]);

const CODE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.css',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.jsx',
  '.json',
  '.kt',
  '.kts',
  '.lua',
  '.md',
  '.php',
  '.pl',
  '.py',
  '.r',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.vue',
  '.xml',
  '.yaml',
  '.yml'
]);

function attachmentError(code, message, statusCode = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeMimeType(value) {
  return String(value || 'application/octet-stream')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()
    .slice(0, 160) || 'application/octet-stream';
}

function normalizeFileName(value) {
  const raw = String(value || '')
    .normalize('NFKC')
    .replace(/\\/g, '/');

  const base = path.posix.basename(raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .trim();

  if (!base || base === '.' || base === '..') {
    throw attachmentError(
      'invalid_attachment_name',
      'The attachment name is invalid.'
    );
  }

  const shortened =
    base.length > MAX_ATTACHMENT_NAME_LENGTH
      ? base.slice(base.length - MAX_ATTACHMENT_NAME_LENGTH)
      : base;

  return shortened;
}

function fileExtension(fileName) {
  return path.extname(normalizeFileName(fileName))
    .trim()
    .toLowerCase();
}

function isBlockedAttachment({ fileName, mimeType }) {
  const extension = fileExtension(fileName);
  const normalizedMime = normalizeMimeType(mimeType);

  return (
    BLOCKED_EXTENSIONS.has(extension) ||
    BLOCKED_MIME_TYPES.has(normalizedMime)
  );
}

function classifyAssetType({ fileName, mimeType }) {
  const normalizedMime = normalizeMimeType(mimeType);
  const extension = fileExtension(fileName);

  if (normalizedMime.startsWith('image/')) return 'image';
  if (normalizedMime.startsWith('audio/')) return 'audio';
  if (normalizedMime.startsWith('video/')) return 'video';
  if (CODE_EXTENSIONS.has(extension)) return 'code';

  return 'file';
}

function validateUploadRequest({
  fileName,
  mimeType,
  sizeBytes
}) {
  const safeName = normalizeFileName(fileName);
  const normalizedMime = normalizeMimeType(mimeType);
  const normalizedSize = Number(sizeBytes);

  if (
    !Number.isInteger(normalizedSize) ||
    normalizedSize < 1
  ) {
    throw attachmentError(
      'invalid_attachment_size',
      'The attachment size is invalid.'
    );
  }

  if (normalizedSize > MAX_ATTACHMENT_BYTES) {
    throw attachmentError(
      'attachment_too_large',
      'The attachment exceeds the 600 MB limit.',
      413
    );
  }

  if (
    isBlockedAttachment({
      fileName: safeName,
      mimeType: normalizedMime
    })
  ) {
    throw attachmentError(
      'dangerous_attachment_type',
      'This file type is blocked for security.',
      415
    );
  }

  return {
    fileName: safeName,
    mimeType: normalizedMime,
    sizeBytes: normalizedSize,
    extension: fileExtension(safeName),
    assetType: classifyAssetType({
      fileName: safeName,
      mimeType: normalizedMime
    }),
    scanStatus: 'pending',
    extractionStatus: 'pending'
  };
}

function safeIdentifier(value, label) {
  const normalized = String(value || '').trim();

  if (!/^[0-9a-z_-]{1,80}$/i.test(normalized)) {
    throw attachmentError(
      `invalid_${label}`,
      `Invalid ${label}.`
    );
  }

  return normalized;
}

function buildStoragePath({
  ownerId,
  conversationId,
  fileName,
  uploadId
}) {
  const owner = safeIdentifier(ownerId, 'attachment_owner');
  const conversation =
    safeIdentifier(conversationId, 'attachment_conversation');
  const upload = safeIdentifier(uploadId, 'attachment_upload');
  const safeName = normalizeFileName(fileName);

  return `${owner}/${conversation}/${upload}-${safeName}`;
}

module.exports = {
  ATTACHMENT_BUCKET,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_NAME_LENGTH,
  BLOCKED_EXTENSIONS,
  BLOCKED_MIME_TYPES,
  CODE_EXTENSIONS,
  attachmentError,
  normalizeMimeType,
  normalizeFileName,
  fileExtension,
  isBlockedAttachment,
  classifyAssetType,
  validateUploadRequest,
  buildStoragePath
};
