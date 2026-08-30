'use strict';

const fs = require('fs');
const {
  CODE_EXTENSIONS,
  fileExtension
} = require('./conversationAttachments');
const {
  TEXT_EXTENSIONS
} = require('./attachmentExtraction');

const DEFAULT_TEXT_CHUNK_CHARS = 48000;
const DEFAULT_TEXT_CHUNK_OVERLAP = 1000;
const MAX_TEXT_CHUNKS = 20000;

function chunkingError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function textEncoding(head) {
  if (!Buffer.isBuffer(head)) return 'utf8';
  if (
    head.length >= 2 &&
    head[0] === 0xff &&
    head[1] === 0xfe
  ) {
    return 'utf16le';
  }
  return 'utf8';
}

function headLooksTextual(head, encoding) {
  if (!Buffer.isBuffer(head) || !head.length) return true;

  if (encoding === 'utf16le') return true;

  let suspicious = 0;
  for (const byte of head) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) {
      suspicious += 1;
    }
  }
  return suspicious / head.length < 0.02;
}

function isChunkableTextFile({ fileName, mimeType, head }) {
  const extension = fileExtension(fileName);
  const mime = String(mimeType || '').toLowerCase();
  const declaredText =
    TEXT_EXTENSIONS.has(extension) ||
    CODE_EXTENSIONS.has(extension) ||
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml';

  if (!declaredText) return false;

  const encoding = textEncoding(head);
  return headLooksTextual(head, encoding);
}

function selectChunkEnd(buffer, target) {
  if (buffer.length <= target) return buffer.length;
  const floor = Math.floor(target * 0.7);
  const newline = buffer.lastIndexOf('\n', target - 1);
  return newline >= floor ? newline + 1 : target;
}

async function* streamTextChunks({
  filePath,
  chunkChars = Number(
    process.env.ATTACHMENT_TEXT_CHUNK_CHARS ||
    DEFAULT_TEXT_CHUNK_CHARS
  ),
  overlapChars = Number(
    process.env.ATTACHMENT_TEXT_CHUNK_OVERLAP ||
    DEFAULT_TEXT_CHUNK_OVERLAP
  ),
  encoding = 'utf8'
}) {
  const safeChunkChars = Math.floor(chunkChars);
  const safeOverlapChars = Math.floor(overlapChars);

  if (
    !Number.isInteger(safeChunkChars) ||
    safeChunkChars < 4096 ||
    safeChunkChars > 65536 ||
    !Number.isInteger(safeOverlapChars) ||
    safeOverlapChars < 0 ||
    safeOverlapChars >= Math.floor(safeChunkChars / 2)
  ) {
    throw chunkingError('invalid_attachment_chunk_configuration');
  }

  let pending = '';
  let chunkIndex = 0;
  let charStart = 0;
  const input = fs.createReadStream(filePath, {
    encoding,
    highWaterMark: 64 * 1024
  });

  for await (const raw of input) {
    pending += String(raw).replace(/\u0000/g, '');

    while (pending.length >= safeChunkChars) {
      const end = selectChunkEnd(pending, safeChunkChars);
      const content = pending.slice(0, end);

      if (content.length) {
        if (chunkIndex >= MAX_TEXT_CHUNKS) {
          throw chunkingError('attachment_chunk_limit_exceeded');
        }

        yield {
          chunkIndex,
          charStart,
          charEnd: charStart + content.length,
          content,
          metadata: { encoding }
        };
        chunkIndex += 1;
      }

      const keepFrom = Math.max(0, end - safeOverlapChars);
      charStart += keepFrom;
      pending = pending.slice(keepFrom);
    }
  }

  if (pending.length) {
    if (chunkIndex >= MAX_TEXT_CHUNKS) {
      throw chunkingError('attachment_chunk_limit_exceeded');
    }

    yield {
      chunkIndex,
      charStart,
      charEnd: charStart + pending.length,
      content: pending,
      metadata: { encoding }
    };
  }
}

module.exports = {
  DEFAULT_TEXT_CHUNK_CHARS,
  DEFAULT_TEXT_CHUNK_OVERLAP,
  MAX_TEXT_CHUNKS,
  chunkingError,
  textEncoding,
  headLooksTextual,
  isChunkableTextFile,
  streamTextChunks
};
