'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const validation = fs.readFileSync(path.join(__dirname, 'lib/inputValidation.js'), 'utf8');
const turn = fs.readFileSync(path.join(__dirname, 'lib/conversationTurn.js'), 'utf8');
const flags = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/feature-flags.json'), 'utf8'));

for (const marker of ["require('./lib/chatCapabilities')", "require('./lib/sourceContract')", "chatMode = 'standard'", 'assertChatModeAvailable(chatMode)', 'const responseSources = attachmentSources', 'sources: responseSources']) assert(server.includes(marker), `Missing server marker: ${marker}`);
assert(server.indexOf('assertChatModeAvailable(chatMode)') < server.indexOf('reservation = await reserveCredits'));
assert(validation.includes('ALLOWED_CHAT_MODES'));
assert(validation.includes("'standard', 'web_search', 'deep_research', 'shopping'"));
assert(turn.includes('sources: Array.isArray(sources) ? sources : []'));
assert(turn.includes('source_count: Array.isArray(sources) ? sources.length : 0'));
assert.equal(flags.chat_sources.enabled, true);
for (const key of ['file_analysis', 'web_search', 'deep_research', 'shopping']) assert.equal(flags[key].enabled, false);

console.log('PASS: Pack 03 Chat-mode validation, pre-charge guard, source response and memory wiring');
