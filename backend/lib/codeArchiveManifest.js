'use strict';

const { normalizeCodeProject } = require('./codeProjectContract');

function buildCodeArchiveManifest(projectInput) {
  const project = normalizeCodeProject(projectInput);
  const files = [...project.files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(file => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 }));
  return Object.freeze({
    format: 'zuvyr-code-project.v1',
    projectName: project.name,
    entryFile: project.entryFile,
    fileCount: files.length,
    totalBytes: project.totalBytes,
    files: Object.freeze(files)
  });
}

module.exports = { buildCodeArchiveManifest };
