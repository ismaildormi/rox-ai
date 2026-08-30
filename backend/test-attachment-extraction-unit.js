'use strict';

const assert = require('assert');
const JSZip = require('jszip');
const {
  extractXmlText,
  hasExecutableMagic,
  inspectAttachmentBuffer,
  extractAttachment
} = require('./lib/attachmentExtraction');

async function run() {
  assert.strictEqual(
    extractXmlText(
      '<a:t>Hello &amp; welcome</a:t>' +
      '<a:t>العالم</a:t>'
    ),
    'Hello & welcome العالم'
  );

  const executable = Buffer.alloc(256);
  executable[0] = 0x4d;
  executable[1] = 0x5a;

  assert.strictEqual(
    hasExecutableMagic(executable),
    true
  );

  await assert.rejects(
    () => inspectAttachmentBuffer({
      buffer: executable,
      fileName: 'fake-report.pdf',
      mimeType: 'application/pdf'
    }),
    error => (
      error.code ===
        'dangerous_attachment_content' &&
      error.statusCode === 415
    )
  );

  let result = await extractAttachment({
    buffer: Buffer.from(
      'Hello from a safe text file.'
    ),
    fileName: 'notes.txt',
    mimeType: 'text/plain'
  });

  assert.strictEqual(result.status, 'ready');
  assert.strictEqual(result.mode, 'plain_text');
  assert.ok(
    result.text.includes('safe text file')
  );

  const xlsx = new JSZip();

  xlsx.file(
    'xl/sharedStrings.xml',
    '<sst>' +
      '<si><t>Name</t></si>' +
      '<si><t>ZUVYR</t></si>' +
    '</sst>'
  );

  xlsx.file(
    'xl/worksheets/sheet1.xml',
    '<worksheet><sheetData><row>' +
      '<c r="A1" t="s"><v>0</v></c>' +
      '<c r="B1" t="s"><v>1</v></c>' +
      '<c r="C1"><f>1+1</f><v>2</v></c>' +
    '</row></sheetData></worksheet>'
  );

  result = await extractAttachment({
    buffer: await xlsx.generateAsync({
      type: 'nodebuffer'
    }),
    fileName: 'budget.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  assert.strictEqual(result.status, 'ready');
  assert.strictEqual(result.mode, 'spreadsheet');
  assert.ok(result.text.includes('A1: Name'));
  assert.ok(result.text.includes('B1: ZUVYR'));
  assert.ok(
    result.text.includes(
      'C1: FORMULA 1+1 = 2'
    )
  );

  const pptx = new JSZip();

  pptx.file(
    'ppt/slides/slide1.xml',
    '<p:sld><a:t>First slide</a:t>' +
    '<a:t>Project plan</a:t></p:sld>'
  );

  result = await extractAttachment({
    buffer: await pptx.generateAsync({
      type: 'nodebuffer'
    }),
    fileName: 'presentation.pptx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  });

  assert.strictEqual(result.status, 'ready');
  assert.strictEqual(result.mode, 'presentation');
  assert.ok(result.text.includes('First slide'));
  assert.ok(result.text.includes('Project plan'));

  const archive = new JSZip();

  archive.file(
    'readme.txt',
    'Safe archive content'
  );

  result = await extractAttachment({
    buffer: await archive.generateAsync({
      type: 'nodebuffer'
    }),
    fileName: 'project.zip',
    mimeType: 'application/zip'
  });

  assert.strictEqual(result.status, 'ready');
  assert.strictEqual(result.mode, 'archive');
  assert.ok(
    result.text.includes('Safe archive content')
  );

  const macro = new JSZip();

  macro.file(
    'word/document.xml',
    '<w:document><w:t>Visible text</w:t></w:document>'
  );

  macro.file(
    'word/vbaProject.bin',
    Buffer.from([1, 2, 3, 4])
  );

  const macroBuffer =
    await macro.generateAsync({
      type: 'nodebuffer'
    });

  await assert.rejects(
    () => extractAttachment({
      buffer: macroBuffer,
      fileName: 'unsafe.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }),
    error => (
      error.code ===
        'dangerous_attachment_content' &&
      error.statusCode === 415
    )
  );

  result = await extractAttachment({
    buffer: Buffer.from(
      'ID3' + 'audio-placeholder'
    ),
    fileName: 'song.mp3',
    mimeType: 'audio/mpeg'
  });

  assert.strictEqual(
    result.status,
    'provider_required'
  );
  assert.strictEqual(result.mode, 'audio');

  result = await extractAttachment({
    buffer: Buffer.from([
      0x01,
      0x02,
      0x03,
      0x04
    ]),
    fileName: 'unknown.safeformat',
    mimeType: 'application/octet-stream'
  });

  assert.strictEqual(
    result.status,
    'unsupported'
  );

  console.log(
    'PASS: secure attachment extraction unit tests'
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
