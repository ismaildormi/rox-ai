'use strict';

const assert = require('assert');
const {
  ATTACHMENT_BUCKET,
  MAX_ATTACHMENT_BYTES,
  normalizeFileName,
  classifyAssetType,
  validateUploadRequest,
  buildStoragePath
} = require('./lib/conversationAttachments');

assert.strictEqual(
  ATTACHMENT_BUCKET,
  'conversation-files'
);

[
  ['report.pdf', 'application/pdf', 'file'],
  [
    'proposal.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'file'
  ],
  [
    'budget.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'file'
  ],
  [
    'slides.pptx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'file'
  ],
  ['track.mp3', 'audio/mpeg', 'audio'],
  ['recording.wav', 'audio/wav', 'audio'],
  ['movie.mp4', 'video/mp4', 'video'],
  ['photo.png', 'image/png', 'image'],
  ['project.py', 'text/x-python', 'code'],
  ['component.tsx', 'text/plain', 'code'],
  ['notes.txt', 'text/plain', 'file'],
  ['unknown.safeformat', 'application/octet-stream', 'file']
].forEach(([fileName, mimeType, assetType]) => {
  const result = validateUploadRequest({
    fileName,
    mimeType,
    sizeBytes: 1024
  });

  assert.strictEqual(result.assetType, assetType);
  assert.strictEqual(result.scanStatus, 'pending');
  assert.strictEqual(result.extractionStatus, 'pending');
});

assert.strictEqual(
  classifyAssetType({
    fileName: 'song.flac',
    mimeType: 'audio/flac'
  }),
  'audio'
);

assert.strictEqual(
  normalizeFileName('../../safe/report.pdf'),
  'report.pdf'
);

assert.strictEqual(
  buildStoragePath({
    ownerId: '11111111-1111-4111-8111-111111111111',
    conversationId: '22222222-2222-4222-8222-222222222222',
    uploadId: '33333333-3333-4333-8333-333333333333',
    fileName: '../../report.pdf'
  }),
  '11111111-1111-4111-8111-111111111111/' +
  '22222222-2222-4222-8222-222222222222/' +
  '33333333-3333-4333-8333-333333333333-report.pdf'
);

[
  ['malware.exe', 'application/octet-stream'],
  ['driver.dll', 'application/octet-stream'],
  ['installer.msi', 'application/x-msi'],
  ['android.apk', 'application/vnd.android.package-archive'],
  ['macro.docm', 'application/octet-stream'],
  ['macro.xlsm', 'application/octet-stream'],
  ['macro.pptm', 'application/octet-stream'],
  ['fake.pdf', 'application/x-msdownload']
].forEach(([fileName, mimeType]) => {
  assert.throws(
    () => validateUploadRequest({
      fileName,
      mimeType,
      sizeBytes: 1024
    }),
    error => (
      error.code === 'dangerous_attachment_type' &&
      error.statusCode === 415
    )
  );
});

assert.throws(
  () => validateUploadRequest({
    fileName: 'empty.txt',
    mimeType: 'text/plain',
    sizeBytes: 0
  }),
  error => error.code === 'invalid_attachment_size'
);

assert.throws(
  () => validateUploadRequest({
    fileName: 'huge.mp4',
    mimeType: 'video/mp4',
    sizeBytes: MAX_ATTACHMENT_BYTES + 1
  }),
  error => (
    error.code === 'attachment_too_large' &&
    error.statusCode === 413
  )
);

console.log(
  'PASS: conversation attachment safety and classification unit tests'
);
