'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

const OFFICE_EXTENSIONS = new Set([
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.odt', '.ods', '.odp', '.rtf'
]);
const OFFICE_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf',
  'text/rtf'
]);
const DEFAULT_MAX_DOCUMENT_PAGES = 10000;
const DEFAULT_MAX_DOCUMENT_TEXT_BYTES = 768 * 1024 * 1024;
const DEFAULT_TOOL_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_PAGE_TOOL_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_OCR_DPI = 150;
const MAX_TOOL_OUTPUT_BYTES = 8 * 1024 * 1024;

function documentToolError(code, message = code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function extensionFor(fileName) {
  return path.extname(String(fileName || '').trim()).toLowerCase();
}

function normalizeMimeType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function documentKind({ fileName, mimeType } = {}) {
  const extension = extensionFor(fileName);
  const mime = normalizeMimeType(mimeType);
  if (extension === '.pdf' || mime === 'application/pdf') return 'pdf';
  if (OFFICE_EXTENSIONS.has(extension) || OFFICE_MIME_TYPES.has(mime)) {
    return 'office';
  }
  return null;
}

function toolsEnabled(value = process.env.ATTACHMENT_DOCUMENT_TOOLS_ENABLED) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value || '').trim().toLowerCase()
  );
}

function canProcessDocumentWithTools({
  fileName,
  mimeType,
  result,
  enabled
} = {}) {
  if (!result || result.status !== 'provider_required') return false;
  if (!toolsEnabled(enabled)) return false;
  return Boolean(documentKind({ fileName, mimeType }));
}

function parsePdfInfo(stdout) {
  const text = String(stdout || '');
  const pagesMatch = text.match(/^Pages:\s+(\d+)\s*$/mi);
  const encryptedMatch = text.match(/^Encrypted:\s+([^\r\n]+)$/mi);
  const pageCount = pagesMatch ? Number(pagesMatch[1]) : 0;
  const encrypted = encryptedMatch
    ? /^yes\b/i.test(encryptedMatch[1].trim())
    : false;
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw documentToolError('document_page_count_invalid');
  }
  return { pageCount, encrypted };
}

function readableText(value) {
  const normalized = String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\f/g, '\n')
    .trim();
  const meaningful = normalized.replace(/\s+/g, '');
  return meaningful.length >= 12 ? normalized : '';
}

function runCommand(command, args, {
  cwd,
  env = process.env,
  timeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
  maxOutputBytes = MAX_TOOL_OUTPUT_BYTES
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(documentToolError('document_tool_timeout', command));
    }, timeoutMs);

    const collect = (target, chunk, isStdout) => {
      const bytes = Buffer.byteLength(chunk);
      if (isStdout) stdoutBytes += bytes;
      else stderrBytes += bytes;
      if (stdoutBytes > maxOutputBytes || stderrBytes > maxOutputBytes) {
        child.kill('SIGKILL');
        finish(documentToolError('document_tool_output_too_large', command));
        return;
      }
      target.push(Buffer.from(chunk));
    };
    child.stdout.on('data', chunk => collect(stdout, chunk, true));
    child.stderr.on('data', chunk => collect(stderr, chunk, false));
    child.on('error', error => finish(
      documentToolError('document_tool_start_failed', command, {
        cause: error.message
      })
    ));
    child.on('close', (code, signal) => {
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      };
      if (code !== 0) {
        finish(documentToolError('document_tool_failed', command, {
          code,
          signal,
          stderr: result.stderr.slice(0, 4000)
        }));
        return;
      }
      finish(null, result);
    });
  });
}

async function hardLinkWithExtension(sourcePath, directory, extension) {
  const target = path.join(directory, 'source' + extension);
  try {
    await fsp.link(sourcePath, target);
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    await fsp.copyFile(sourcePath, target, fs.constants.COPYFILE_EXCL);
  }
  return target;
}

async function convertOfficeToPdf({
  filePath,
  fileName,
  workDir,
  commandRunner,
  timeoutMs
}) {
  const extension = extensionFor(fileName);
  if (!OFFICE_EXTENSIONS.has(extension)) {
    throw documentToolError('document_office_extension_unsupported');
  }
  const inputDir = path.join(workDir, 'office-input');
  const outputDir = path.join(workDir, 'office-output');
  const profileDir = path.join(workDir, 'libreoffice-profile');
  await Promise.all([
    fsp.mkdir(inputDir, { recursive: true }),
    fsp.mkdir(outputDir, { recursive: true }),
    fsp.mkdir(profileDir, { recursive: true })
  ]);
  const safeInput = await hardLinkWithExtension(filePath, inputDir, extension);
  await commandRunner('soffice', [
    '--headless',
    '--safe-mode',
    '--nologo',
    '--nodefault',
    '--nolockcheck',
    '--norestore',
    '-env:UserInstallation=' + pathToFileURL(profileDir).href,
    '--convert-to',
    'pdf',
    '--outdir',
    outputDir,
    safeInput
  ], { cwd: workDir, timeoutMs });
  const outputs = (await fsp.readdir(outputDir))
    .filter(name => name.toLowerCase().endsWith('.pdf'));
  if (outputs.length !== 1) {
    throw documentToolError('document_office_conversion_failed');
  }
  return path.join(outputDir, outputs[0]);
}

async function appendBounded(handle, value, state, maxBytes) {
  const text = String(value || '');
  const bytes = Buffer.byteLength(text, 'utf8');
  if (state.bytes + bytes > maxBytes) {
    throw documentToolError('document_extracted_text_too_large');
  }
  await handle.appendFile(text, 'utf8');
  state.bytes += bytes;
}

async function extractPdfPages({
  pdfPath,
  workDir,
  commandRunner,
  maxPages,
  maxTextBytes,
  toolTimeoutMs,
  pageToolTimeoutMs,
  ocrDpi,
  ocrLanguages
}) {
  const info = await commandRunner(
    'pdfinfo',
    [pdfPath],
    { cwd: workDir, timeoutMs: toolTimeoutMs }
  );
  const { pageCount, encrypted } = parsePdfInfo(info.stdout);
  if (encrypted) {
    throw documentToolError('attachment_password_protected');
  }
  if (pageCount > maxPages) {
    throw documentToolError('document_page_limit_exceeded', undefined, {
      pageCount,
      maxPages
    });
  }

  const textFile = path.join(workDir, 'document-text.txt');
  const pagesDir = path.join(workDir, 'pages');
  await fsp.mkdir(pagesDir, { recursive: true });
  const output = await fsp.open(textFile, 'wx', 0o600);
  const state = { bytes: 0 };
  let textPages = 0;
  let ocrPages = 0;

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const pageTag = String(pageNumber).padStart(6, '0');
      const pageTextPath = path.join(pagesDir, 'page-' + pageTag + '.txt');
      await commandRunner('pdftotext', [
        '-f', String(pageNumber),
        '-l', String(pageNumber),
        '-enc', 'UTF-8',
        '-nopgbrk',
        pdfPath,
        pageTextPath
      ], { cwd: workDir, timeoutMs: pageToolTimeoutMs });
      let pageText = readableText(await fsp.readFile(pageTextPath, 'utf8'));
      await fsp.rm(pageTextPath, { force: true });

      if (pageText) {
        textPages += 1;
      } else {
        const imagePrefix = path.join(pagesDir, 'ocr-' + pageTag);
        const imagePath = imagePrefix + '.png';
        await commandRunner('pdftoppm', [
          '-f', String(pageNumber),
          '-l', String(pageNumber),
          '-singlefile',
          '-r', String(ocrDpi),
          '-gray',
          '-png',
          pdfPath,
          imagePrefix
        ], { cwd: workDir, timeoutMs: pageToolTimeoutMs });
        const ocr = await commandRunner('tesseract', [
          imagePath,
          'stdout',
          '-l', ocrLanguages,
          '--psm', '3'
        ], { cwd: workDir, timeoutMs: pageToolTimeoutMs });
        pageText = readableText(ocr.stdout);
        await fsp.rm(imagePath, { force: true });
        if (pageText) ocrPages += 1;
      }

      if (pageText) {
        await appendBounded(
          output,
          `\n\n[Page ${pageNumber}]\n${pageText}\n`,
          state,
          maxTextBytes
        );
      }
    }
  } finally {
    await output.close();
  }

  if (!state.bytes) {
    return {
      status: 'provider_required',
      mode: 'document_no_text',
      text: '',
      reason: 'No readable text was produced by PDF text extraction or OCR.',
      pageCount,
      textPages,
      ocrPages
    };
  }
  return {
    status: 'ready',
    mode: ocrPages ? 'document_text_ocr' : 'document_text',
    text: '',
    textFile,
    pageCount,
    textPages,
    ocrPages,
    provider: 'zuvyr-document-tools',
    model: 'libreoffice-poppler-tesseract',
    usage: {
      page_count: pageCount,
      text_pages: textPages,
      ocr_pages: ocrPages
    }
  };
}

async function extractDocumentWithTools({
  filePath,
  fileName,
  mimeType,
  tempDir,
  enabled = process.env.ATTACHMENT_DOCUMENT_TOOLS_ENABLED,
  commandRunner = runCommand,
  maxPages = Number(
    process.env.ATTACHMENT_MAX_DOCUMENT_PAGES ||
    DEFAULT_MAX_DOCUMENT_PAGES
  ),
  maxTextBytes = Number(
    process.env.ATTACHMENT_MAX_DOCUMENT_TEXT_BYTES ||
    DEFAULT_MAX_DOCUMENT_TEXT_BYTES
  ),
  toolTimeoutMs = Number(
    process.env.ATTACHMENT_DOCUMENT_TOOL_TIMEOUT_MS ||
    DEFAULT_TOOL_TIMEOUT_MS
  ),
  pageToolTimeoutMs = Number(
    process.env.ATTACHMENT_DOCUMENT_PAGE_TIMEOUT_MS ||
    DEFAULT_PAGE_TOOL_TIMEOUT_MS
  ),
  ocrDpi = Number(
    process.env.ATTACHMENT_OCR_DPI || DEFAULT_OCR_DPI
  ),
  ocrLanguages = String(
    process.env.ATTACHMENT_OCR_LANGUAGES || 'eng+ara+fra'
  )
} = {}) {
  if (!toolsEnabled(enabled)) {
    throw documentToolError('document_tools_disabled');
  }
  if (!filePath || !tempDir) {
    throw documentToolError('document_source_missing');
  }
  const kind = documentKind({ fileName, mimeType });
  if (!kind) throw documentToolError('document_type_unsupported');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50000) {
    throw documentToolError('document_page_limit_invalid');
  }
  if (!Number.isInteger(maxTextBytes) || maxTextBytes < 1024 * 1024) {
    throw documentToolError('document_text_limit_invalid');
  }
  if (!Number.isInteger(ocrDpi) || ocrDpi < 72 || ocrDpi > 300) {
    throw documentToolError('document_ocr_dpi_invalid');
  }
  if (!/^[a-z]{3}(\+[a-z]{3}){0,7}$/i.test(ocrLanguages)) {
    throw documentToolError('document_ocr_languages_invalid');
  }

  const workDir = await fsp.mkdtemp(
    path.join(tempDir, 'document-tools-')
  );
  let pdfPath = filePath;
  if (kind === 'office') {
    pdfPath = await convertOfficeToPdf({
      filePath,
      fileName,
      workDir,
      commandRunner,
      timeoutMs: toolTimeoutMs
    });
  }
  const result = await extractPdfPages({
    pdfPath,
    workDir,
    commandRunner,
    maxPages,
    maxTextBytes,
    toolTimeoutMs,
    pageToolTimeoutMs,
    ocrDpi,
    ocrLanguages
  });
  return {
    ...result,
    convertedFromOffice: kind === 'office'
  };
}

module.exports = {
  OFFICE_EXTENSIONS,
  OFFICE_MIME_TYPES,
  DEFAULT_MAX_DOCUMENT_PAGES,
  DEFAULT_MAX_DOCUMENT_TEXT_BYTES,
  DEFAULT_TOOL_TIMEOUT_MS,
  DEFAULT_PAGE_TOOL_TIMEOUT_MS,
  DEFAULT_OCR_DPI,
  documentToolError,
  extensionFor,
  normalizeMimeType,
  documentKind,
  toolsEnabled,
  canProcessDocumentWithTools,
  parsePdfInfo,
  readableText,
  runCommand,
  extractDocumentWithTools
};
