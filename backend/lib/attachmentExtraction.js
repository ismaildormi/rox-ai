'use strict';

const JSZip = require('jszip');
const mammoth = require('mammoth');
const {
  CODE_EXTENSIONS,
  fileExtension,
  isBlockedAttachment,
  validateUploadRequest
} = require('./conversationAttachments');

const MAX_EXTRACTED_CHARS = 120000;
const MAX_ARCHIVE_ENTRIES = 500;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES =
  150 * 1024 * 1024;
const MAX_ZIP_TEXT_ENTRY_BYTES =
  10 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.csv',
  '.css',
  '.html',
  '.ini',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.md',
  '.php',
  '.py',
  '.r',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml'
]);

function extractionError(
  code,
  message,
  statusCode = 422
) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function capText(value) {
  const text = String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .trim();

  if (text.length <= MAX_EXTRACTED_CHARS) {
    return text;
  }

  return (
    text.slice(0, MAX_EXTRACTED_CHARS) +
    '\n\n[Content truncated by ZUVYR]'
  );
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, number) =>
      String.fromCodePoint(parseInt(number, 10))
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function extractXmlText(xml) {
  const parts = [];
  const pattern =
    /<(?:[a-z0-9_-]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-z0-9_-]+:)?t>/gi;

  let match;

  while ((match = pattern.exec(String(xml || '')))) {
    parts.push(
      decodeXmlEntities(
        match[1].replace(/<[^>]+>/g, '')
      )
    );

    if(parts.join(' ').length >= MAX_EXTRACTED_CHARS){
      break;
    }
  }

  return capText(parts.join(' '));
}

function hasExecutableMagic(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return false;
  }

  if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return true;
  }

  if (
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  ) {
    return true;
  }

  const signature = buffer.readUInt32BE(0);

  return new Set([
    0xcafebabe,
    0xfeedface,
    0xfeedfacf,
    0xcefaedfe,
    0xcffaedfe
  ]).has(signature);
}

async function detectFileType(buffer) {
  const {
    fileTypeFromBuffer
  } = await import('file-type');

  return fileTypeFromBuffer(buffer);
}

function zipEntrySizes(entry) {
  const data = entry && entry._data;

  return {
    compressed:
      Number(data && data.compressedSize) || 0,
    uncompressed:
      Number(data && data.uncompressedSize) || 0
  };
}

async function inspectZip(buffer) {
  let zip;

  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    throw extractionError(
      'attachment_archive_unreadable',
      'The archive is encrypted, damaged, or unreadable.'
    );
  }

  const entries = Object.values(zip.files);

  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw extractionError(
      'attachment_archive_too_complex',
      'The archive contains too many entries.'
    );
  }

  let totalUncompressed = 0;

  for (const entry of entries) {
    if (entry.dir) continue;

    const sizes = zipEntrySizes(entry);
    totalUncompressed += sizes.uncompressed;

    if (
      sizes.uncompressed >
        MAX_ARCHIVE_UNCOMPRESSED_BYTES ||
      totalUncompressed >
        MAX_ARCHIVE_UNCOMPRESSED_BYTES
    ) {
      throw extractionError(
        'attachment_archive_expansion_blocked',
        'The archive expands beyond the safe limit.'
      );
    }

    if (
      sizes.compressed > 0 &&
      sizes.uncompressed > 1024 * 1024 &&
      sizes.uncompressed / sizes.compressed > 200
    ) {
      throw extractionError(
        'attachment_archive_expansion_blocked',
        'The archive compression ratio is unsafe.'
      );
    }

    const normalizedName =
      String(entry.name || '')
        .replace(/\\/g, '/')
        .toLowerCase();

    if (
      normalizedName.includes('vbaproject.bin') ||
      normalizedName.includes('_vba_project_cur') ||
      normalizedName.includes('/activex/') ||
      normalizedName.includes('/embeddings/')
    ) {
      throw extractionError(
        'dangerous_attachment_content',
        'Embedded macros or executable objects are blocked.',
        415
      );
    }
  }

  return {
    zip,
    entries,
    totalUncompressed
  };
}

async function readZipText(
  zip,
  entryName,
  required = true
) {
  const entry = zip.file(entryName);

  if (!entry) {
    if (required) {
      throw extractionError(
        'attachment_document_structure_invalid',
        `Required document entry is missing: ${entryName}`
      );
    }

    return '';
  }

  const sizes = zipEntrySizes(entry);

  if (
    sizes.uncompressed >
    MAX_ZIP_TEXT_ENTRY_BYTES
  ) {
    throw extractionError(
      'attachment_document_too_complex',
      'A document section exceeds the safe extraction limit.'
    );
  }

  return entry.async('string');
}

async function extractXlsx(zip) {
  const sharedXml =
    await readZipText(
      zip,
      'xl/sharedStrings.xml',
      false
    );

  const sharedStrings = [];
  const sharedPattern =
    /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi;

  let sharedMatch;

  while (
    (
      sharedMatch =
        sharedPattern.exec(sharedXml)
    )
  ) {
    sharedStrings.push(
      extractXmlText(sharedMatch[1])
    );
  }

  const sheetNames = Object.keys(zip.files)
    .filter(name =>
      /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)
    )
    .sort((a, b) =>
      a.localeCompare(b, undefined, {
        numeric: true
      })
    );

  const output = [];

  for (
    let index = 0;
    index < sheetNames.length;
    index += 1
  ) {
    const xml =
      await readZipText(zip, sheetNames[index]);

    output.push(`Sheet ${index + 1}:`);

    const cellPattern =
      /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;

    let cellMatch;

    while ((cellMatch = cellPattern.exec(xml))) {
      const attributes = cellMatch[1];
      const body = cellMatch[2];

      const reference =
        /\br="([^"]+)"/i.exec(attributes);
      const type =
        /\bt="([^"]+)"/i.exec(attributes);
      const formula =
        /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/i.exec(body);
      const value =
        /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i.exec(body);

      let rendered = '';

      if (
        type &&
        type[1] === 's' &&
        value
      ) {
        rendered =
          sharedStrings[Number(value[1])] || '';
      } else if (
        type &&
        type[1] === 'inlineStr'
      ) {
        rendered = extractXmlText(body);
      } else if (value) {
        rendered =
          decodeXmlEntities(value[1]);
      }

      if (formula) {
        rendered =
          `FORMULA ${decodeXmlEntities(formula[1])}` +
          (rendered ? ` = ${rendered}` : '');
      }

      if (rendered) {
        output.push(
          `${reference ? reference[1] : '?'}: ` +
          rendered
        );
      }

      if(output.join('\n').length >= MAX_EXTRACTED_CHARS){
        break;
      }
    }

    if(output.join('\n').length >= MAX_EXTRACTED_CHARS){
      break;
    }
  }

  return capText(output.join('\n'));
}

async function extractPptx(zip) {
  const slideNames = Object.keys(zip.files)
    .filter(name =>
      /^ppt\/slides\/slide\d+\.xml$/i.test(name)
    )
    .sort((a, b) =>
      a.localeCompare(b, undefined, {
        numeric: true
      })
    );

  const output = [];

  for (
    let index = 0;
    index < slideNames.length;
    index += 1
  ) {
    const xml =
      await readZipText(zip, slideNames[index]);

    const text = extractXmlText(xml);

    if (text) {
      output.push(
        `Slide ${index + 1}:\n${text}`
      );
    }

    if(output.join('\n\n').length >= MAX_EXTRACTED_CHARS){
      break;
    }
  }

  return capText(output.join('\n\n'));
}

async function extractOpenDocument(zip) {
  const xml =
    await readZipText(zip, 'content.xml');

  return extractXmlText(xml);
}

async function extractArchive(zip) {
  const names = Object.keys(zip.files)
    .filter(name => !zip.files[name].dir)
    .slice(0, 100);

  const output = [
    'Archive entries:',
    ...names.map(name => `- ${name}`)
  ];

  let extractedFiles = 0;

  for (const name of names) {
    if (extractedFiles >= 20) break;

    const extension =
      fileExtension(name);

    if (
      !TEXT_EXTENSIONS.has(extension) &&
      !CODE_EXTENSIONS.has(extension)
    ) {
      continue;
    }

    const entry = zip.file(name);
    const sizes = zipEntrySizes(entry);

    if (
      !entry ||
      sizes.uncompressed >
        MAX_ZIP_TEXT_ENTRY_BYTES
    ) {
      continue;
    }

    const text =
      capText(await entry.async('string'));

    if (!text) continue;

    output.push(
      `\nFile: ${name}\n${text}`
    );

    extractedFiles += 1;

    if(output.join('\n').length >= MAX_EXTRACTED_CHARS){
      break;
    }
  }

  return capText(output.join('\n'));
}

async function extractPdf(buffer) {
  const pdfjs =
    await import(
      'pdfjs-dist/legacy/build/pdf.mjs'
    );

  const loadingTask =
    pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      useSystemFonts: true
    });

  let document;

  try {
    document = await loadingTask.promise;

    const pageLimit =
      Math.min(document.numPages, 200);

    const output = [];

    for (
      let pageNumber = 1;
      pageNumber <= pageLimit;
      pageNumber += 1
    ) {
      const page =
        await document.getPage(pageNumber);
      const content =
        await page.getTextContent();

      const text = content.items
        .map(item => item.str || '')
        .join(' ')
        .trim();

      if (text) {
        output.push(
          `Page ${pageNumber}:\n${text}`
        );
      }

      if(output.join('\n\n').length >= MAX_EXTRACTED_CHARS){
        break;
      }
    }

    const text =
      capText(output.join('\n\n'));

    if (!text) {
      return {
        status: 'provider_required',
        mode: 'pdf_ocr',
        text: '',
        reason:
          'The PDF contains scanned pages and requires OCR.'
      };
    }

    return {
      status: 'ready',
      mode: 'pdf_text',
      text,
      metadata: {
        pageCount: document.numPages
      }
    };
  } catch (error) {
    if (
      error &&
      error.name === 'PasswordException'
    ) {
      throw extractionError(
        'attachment_password_protected',
        'The PDF is password protected.'
      );
    }

    throw extractionError(
      'attachment_pdf_unreadable',
      'The PDF is damaged or unreadable.'
    );
  } finally {
    if (document) {
      await document.destroy();
    } else {
      await loadingTask.destroy();
    }
  }
}

async function inspectAttachmentBuffer({
  buffer,
  fileName,
  mimeType
}) {
  if (!Buffer.isBuffer(buffer)) {
    throw extractionError(
      'invalid_attachment_buffer',
      'Attachment data must be a Buffer.'
    );
  }

  const validated =
    validateUploadRequest({
      fileName,
      mimeType,
      sizeBytes: buffer.length
    });

  if (hasExecutableMagic(buffer)) {
    throw extractionError(
      'dangerous_attachment_content',
      'Executable file content is blocked.',
      415
    );
  }

  const detected =
    await detectFileType(buffer);

  if (
    detected &&
    isBlockedAttachment({
      fileName:
        `detected.${detected.ext || 'bin'}`,
      mimeType: detected.mime
    })
  ) {
    throw extractionError(
      'dangerous_attachment_content',
      'Executable file content is blocked.',
      415
    );
  }

  const extension =
    fileExtension(validated.fileName);

  const isZip =
    (
      detected &&
      detected.mime === 'application/zip'
    ) ||
    [
      '.zip',
      '.docx',
      '.dotx',
      '.xlsx',
      '.pptx',
      '.odt',
      '.ods',
      '.odp'
    ].includes(extension);

  const archive =
    isZip
      ? await inspectZip(buffer)
      : null;

  return {
    ...validated,
    detectedMimeType:
      detected ? detected.mime : null,
    detectedExtension:
      detected ? detected.ext : null,
    archive
  };
}

async function extractAttachment({
  buffer,
  fileName,
  mimeType
}) {
  const inspection =
    await inspectAttachmentBuffer({
      buffer,
      fileName,
      mimeType
    });

  const extension =
    fileExtension(inspection.fileName);
  const effectiveMime =
    inspection.detectedMimeType ||
    inspection.mimeType;

  if (
    TEXT_EXTENSIONS.has(extension) ||
    CODE_EXTENSIONS.has(extension) ||
    effectiveMime.startsWith('text/')
  ) {
    return {
      status: 'ready',
      mode: 'plain_text',
      text: capText(
        buffer
          .subarray(
            0,
            Math.min(buffer.length, 2 * 1024 * 1024)
          )
          .toString('utf8')
      ),
      inspection
    };
  }

  if (
    extension === '.docx' ||
    extension === '.dotx'
  ) {
    const result =
      await mammoth.extractRawText({
        buffer
      });

    return {
      status: 'ready',
      mode: 'word',
      text: capText(result.value),
      warnings: result.messages || [],
      inspection
    };
  }

  if (extension === '.xlsx') {
    return {
      status: 'ready',
      mode: 'spreadsheet',
      text:
        await extractXlsx(
          inspection.archive.zip
        ),
      inspection
    };
  }

  if (extension === '.pptx') {
    return {
      status: 'ready',
      mode: 'presentation',
      text:
        await extractPptx(
          inspection.archive.zip
        ),
      inspection
    };
  }

  if (
    extension === '.odt' ||
    extension === '.ods' ||
    extension === '.odp'
  ) {
    return {
      status: 'ready',
      mode: 'open_document',
      text:
        await extractOpenDocument(
          inspection.archive.zip
        ),
      inspection
    };
  }

  if (
    extension === '.pdf' ||
    effectiveMime === 'application/pdf'
  ) {
    const result =
      await extractPdf(buffer);

    return {
      ...result,
      inspection
    };
  }

  if (extension === '.zip') {
    return {
      status: 'ready',
      mode: 'archive',
      text:
        await extractArchive(
          inspection.archive.zip
        ),
      inspection
    };
  }

  if (
    inspection.assetType === 'image' ||
    inspection.assetType === 'audio' ||
    inspection.assetType === 'video'
  ) {
    return {
      status: 'provider_required',
      mode: inspection.assetType,
      text: '',
      reason:
        'A multimodal model is required.',
      inspection
    };
  }

  if (
    ['.doc', '.xls', '.ppt'].includes(extension)
  ) {
    return {
      status: 'provider_required',
      mode: 'legacy_office_conversion',
      text: '',
      reason:
        'The legacy Office file requires secure conversion.',
      inspection
    };
  }

  return {
    status: 'unsupported',
    mode: 'binary',
    text: '',
    reason:
      'The file is stored safely but has no local extractor.',
    inspection
  };
}

module.exports = {
  MAX_EXTRACTED_CHARS,
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  MAX_ZIP_TEXT_ENTRY_BYTES,
  TEXT_EXTENSIONS,
  extractionError,
  capText,
  decodeXmlEntities,
  extractXmlText,
  hasExecutableMagic,
  detectFileType,
  inspectZip,
  inspectAttachmentBuffer,
  extractAttachment
};
