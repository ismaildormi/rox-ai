'use strict';

const assert = require('assert');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  canProcessDocumentWithTools,
  parsePdfInfo,
  extractDocumentWithTools
} = require('./lib/documentToolExtraction');

async function run() {
  assert.deepStrictEqual(
    parsePdfInfo('Pages: 12\nEncrypted: no\n'),
    { pageCount: 12, encrypted: false }
  );
  assert.strictEqual(
    canProcessDocumentWithTools({
      fileName: 'archive.pdf',
      mimeType: 'application/pdf',
      result: { status: 'provider_required' },
      enabled: '1'
    }),
    true
  );
  assert.strictEqual(
    canProcessDocumentWithTools({
      fileName: 'archive.exe',
      mimeType: 'application/octet-stream',
      result: { status: 'provider_required' },
      enabled: '1'
    }),
    false
  );

  const root = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'zuvyr-document-test-')
  );
  try {
    const pdf = path.join(root, 'input.pdf');
    await fsp.writeFile(pdf, '%PDF-test');
    const calls = [];
    const fakeRunner = async (command, args) => {
      calls.push({ command, args });
      if (command === 'pdfinfo') {
        return { stdout: 'Pages: 2\nEncrypted: no\n', stderr: '' };
      }
      if (command === 'pdftotext') {
        const page = Number(args[args.indexOf('-f') + 1]);
        await fsp.writeFile(
          args[args.length - 1],
          page === 1
            ? 'Readable first page content for indexing.'
            : ''
        );
        return { stdout: '', stderr: '' };
      }
      if (command === 'pdftoppm') {
        await fsp.writeFile(args[args.length - 1] + '.png', 'image');
        return { stdout: '', stderr: '' };
      }
      if (command === 'tesseract') {
        return {
          stdout: 'مرحبا، contenu OCR français lisible.',
          stderr: ''
        };
      }
      throw new Error('Unexpected command: ' + command);
    };
    const pdfResult = await extractDocumentWithTools({
      filePath: pdf,
      fileName: 'scanned.pdf',
      mimeType: 'application/pdf',
      tempDir: root,
      enabled: '1',
      commandRunner: fakeRunner
    });
    assert.strictEqual(pdfResult.status, 'ready');
    assert.strictEqual(pdfResult.pageCount, 2);
    assert.strictEqual(pdfResult.textPages, 1);
    assert.strictEqual(pdfResult.ocrPages, 1);
    const extracted = await fsp.readFile(pdfResult.textFile, 'utf8');
    assert.ok(extracted.includes('[Page 1]'));
    assert.ok(extracted.includes('[Page 2]'));
    assert.ok(extracted.includes('contenu OCR français'));
    assert.ok(calls.some(call => call.command === 'pdftoppm'));
    assert.ok(calls.some(call => call.command === 'tesseract'));

    const office = path.join(root, 'office.bin');
    await fsp.writeFile(office, 'office-test');
    const officeRunner = async (command, args) => {
      if (command === 'soffice') {
        const outputDir = args[args.indexOf('--outdir') + 1];
        await fsp.writeFile(path.join(outputDir, 'source.pdf'), '%PDF-office');
        return { stdout: '', stderr: '' };
      }
      if (command === 'pdfinfo') {
        return { stdout: 'Pages: 1\nEncrypted: no\n', stderr: '' };
      }
      if (command === 'pdftotext') {
        await fsp.writeFile(
          args[args.length - 1],
          'Converted Office document text is readable.'
        );
        return { stdout: '', stderr: '' };
      }
      throw new Error('Unexpected command: ' + command);
    };
    const officeResult = await extractDocumentWithTools({
      filePath: office,
      fileName: 'report.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      tempDir: root,
      enabled: '1',
      commandRunner: officeRunner
    });
    assert.strictEqual(officeResult.status, 'ready');
    assert.strictEqual(officeResult.convertedFromOffice, true);
    assert.strictEqual(officeResult.ocrPages, 0);

    const source = await fsp.readFile(
      path.join(__dirname, 'lib', 'attachmentWorker.js'),
      'utf8'
    );
    [
      "require('./documentToolExtraction')",
      'canProcessDocumentWithTools({',
      'extractWithDocumentTools({',
      'documentResult.textFile',
      "mode: documentResult.mode"
    ].forEach(marker => {
      assert.ok(source.includes(marker), 'Missing worker marker: ' + marker);
    });
    assert.ok(source.includes('shell: false') === false);

    const moduleSource = await fsp.readFile(
      path.join(__dirname, 'lib', 'documentToolExtraction.js'),
      'utf8'
    );
    assert.ok(moduleSource.includes('shell: false'));
    assert.ok(moduleSource.includes("'--safe-mode'"));
    assert.ok(moduleSource.includes("'-singlefile'"));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }

  console.log(
    'PASS: bounded Office, PDF, and OCR document processing unit tests'
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
