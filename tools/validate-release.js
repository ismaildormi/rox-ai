#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const failures = [];
const passes = [];

function pass(message) {
  passes.push(message);
  console.log(`PASS: ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL: ${message}`);
}

function walk(dir) {
  const output = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'backups'].includes(entry.name)) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(full));
    else output.push(full);
  }

  return output;
}

function checkNodeSyntax() {
  const files = [
    ...walk(path.join(root, 'backend')),
    ...walk(path.join(root, 'cli')),
  ].filter(file => file.endsWith('.js'));

  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
      encoding: 'utf8',
    });

    if (result.status !== 0) {
      fail(`JavaScript syntax: ${path.relative(root, file)}\n${result.stderr}`);
      return;
    }
  }

  pass(`JavaScript syntax (${files.length} files)`);
}

function checkJson() {
  const files = walk(root).filter(file => file.endsWith('.json'));

  for (const file of files) {
    try {
      JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
      fail(`JSON parse: ${path.relative(root, file)} ΓÇö ${error.message}`);
      return;
    }
  }

  pass(`JSON parse (${files.length} files)`);
}

function extractEmbeddedDocuments(wrapper) {
  const mobileStartTag = '<script type="text/plain" id="rox-src-mobile">';
  const desktopStartTag = '<script type="text/plain" id="rox-src-desktop">';
  const mobileStart = wrapper.indexOf(mobileStartTag);
  const desktopStart = wrapper.indexOf(desktopStartTag);

  if (mobileStart < 0 || desktopStart < 0) {
    throw new Error('Embedded mobile/desktop source markers not found.');
  }

  const mobileOuter = wrapper.slice(
    mobileStart + mobileStartTag.length,
    desktopStart
  );
  const desktopTail = wrapper.slice(desktopStart + desktopStartTag.length);
  const desktopEndMarker = '</script>\n<script>';
  const desktopEnd = desktopTail.indexOf(desktopEndMarker);

  if (desktopEnd < 0) {
    throw new Error('Desktop source closing marker not found.');
  }

  const unescapeEmbeddedScripts = raw =>
    raw.replace(/<\\\/script/gi, '</script');

  return {
    mobile: unescapeEmbeddedScripts(
      mobileOuter.replace(/<\/script>\s*$/, '')
    ),
    desktop: unescapeEmbeddedScripts(
      desktopTail.slice(0, desktopEnd)
    ),
    shell: desktopTail.slice(desktopEnd + '</script>\n'.length),
  };
}

function inlineScripts(html) {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = pattern.exec(html))) {
    const attributes = match[1] || '';
    if (/\bsrc\s*=/.test(attributes)) continue;
    if (/type\s*=\s*["'](?:application\/json|text\/plain)["']/.test(attributes)) continue;
    scripts.push(match[2]);
  }

  return scripts;
}

function checkEmbeddedScripts(documents) {
  for (const [name, html] of Object.entries(documents)) {
    const scripts = inlineScripts(html);

    if (scripts.length === 0) {
      fail(`${name} embedded document has no inline JavaScript.`);
      continue;
    }

    try {
      scripts.forEach((source, index) => {
        new vm.Script(source, { filename: `${name}-inline-${index + 1}.js` });
      });
      pass(`${name} embedded JavaScript (${scripts.length} scripts)`);
    } catch (error) {
      fail(`${name} embedded JavaScript ΓÇö ${error.message}`);
    }
  }
}

function extractI18nObjects(wrapper) {
  const objects = [];
  const marker = 'const ROX_I18N = {';
  let offset = 0;

  while (true) {
    const start = wrapper.indexOf(marker, offset);
    if (start < 0) break;

    const objectStart = start + 'const ROX_I18N = '.length;
    const endMarker = '\n};\n\nfunction getRoxUiLanguage';
    const end = wrapper.indexOf(endMarker, objectStart);

    if (end < 0) {
      throw new Error('Could not locate the end of an ROX_I18N object.');
    }

    const literal = wrapper.slice(objectStart, end + 2);
    objects.push(vm.runInNewContext(`(${literal})`));
    offset = end + endMarker.length;
  }

  return objects;
}

function checkI18n(wrapper) {
  let objects;

  try {
    objects = extractI18nObjects(wrapper);
  } catch (error) {
    fail(`i18n parse ΓÇö ${error.message}`);
    return;
  }

  if (objects.length !== 2) {
    fail(`Expected 2 ROX_I18N objects, found ${objects.length}.`);
    return;
  }

  const expectedLanguages = ['en', 'fr', 'ar', 'es', 'zh'];

  for (const [copyIndex, dictionary] of objects.entries()) {
    const languages = Object.keys(dictionary);
    if (JSON.stringify(languages) !== JSON.stringify(expectedLanguages)) {
      fail(`i18n copy ${copyIndex + 1} languages are not synchronized.`);
      return;
    }

    const sourceKeys = Object.keys(dictionary.en).sort();
    for (const language of expectedLanguages.slice(1)) {
      const keys = Object.keys(dictionary[language]).sort();
      if (JSON.stringify(keys) !== JSON.stringify(sourceKeys)) {
        fail(`i18n copy ${copyIndex + 1}: ${language} keys differ from English.`);
        return;
      }
    }
  }

  const firstKeys = Object.keys(objects[0].en).sort();
  const secondKeys = Object.keys(objects[1].en).sort();
  if (JSON.stringify(firstKeys) !== JSON.stringify(secondKeys)) {
    fail('Mobile and desktop i18n key sets differ.');
    return;
  }

  pass(`i18n synchronization (${firstKeys.length} keys ├ù 5 languages ├ù 2 copies)`);
}

function checkFrontendContracts(wrapper) {
  const requiredCounts = new Map([
    ['sandbox="allow-scripts allow-forms allow-modals allow-downloads"', 4],
    ['if (DEMO_ENABLED && email === DEMO_EMAIL && password === DEMO_PASSWORD)', 2],
    ['data-i18n="settings.shell.title"', 4],
    ['./rox-release-guard.js', 2],
  ]);

  for (const [needle, expected] of requiredCounts) {
    const found = wrapper.split(needle).length - 1;
    if (found !== expected) {
      fail(`Frontend contract ${JSON.stringify(needle)}: expected ${expected}, found ${found}.`);
      return;
    }
  }

  pass('Frontend security/i18n contracts');
}

function main() {
  checkNodeSyntax();
  checkJson();

  const wrapperPath = path.join(root, 'frontend', 'index.html');
  const wrapper = fs.readFileSync(wrapperPath, 'utf8').replace(/^\uFEFF/, '');

  try {
    const documents = extractEmbeddedDocuments(wrapper);
    checkEmbeddedScripts(documents);
  } catch (error) {
    fail(`Embedded document extraction ΓÇö ${error.message}`);
  }

  checkI18n(wrapper);
  checkFrontendContracts(wrapper);

  console.log(`\nSummary: ${passes.length} passed, ${failures.length} failed.`);
  if (failures.length > 0) process.exit(1);
}

main();
