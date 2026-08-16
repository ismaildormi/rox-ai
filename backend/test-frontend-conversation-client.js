'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const frontend = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'index.html'),
  'utf8'
);

function count(text) {
  return frontend.split(text).length - 1;
}

assert.strictEqual(
  count('const activeRoxConversationIds = {'),
  2,
  'Both frontend copies need five-service active conversation state.'
);

assert.strictEqual(
  count('const roxConversationCreationPromises = {'),
  2,
  'Both copies need duplicate-creation protection.'
);

assert.strictEqual(
  count('function normalizeRoxConversationFeature(feature)'),
  2,
  'Both copies need service normalization.'
);

assert.strictEqual(
  count('function createRoxClientUuid()'),
  2,
  'Both copies need UUID generation.'
);

assert.strictEqual(
  count('function setActiveRoxConversation(feature, conversationId)'),
  2,
  'Both copies need active conversation restoration.'
);

assert.strictEqual(
  count('function resetActiveRoxConversation(feature)'),
  2,
  'Both copies need New Chat reset support.'
);

assert.strictEqual(
  count('async function ensureRoxConversation(feature, firstText = \'\')'),
  2,
  'Both copies need durable conversation creation.'
);

assert.strictEqual(
  count("'/api/conversations'"),
  2,
  'Both real clients must create conversations through the authenticated API.'
);

assert.strictEqual(
  count('function createRoxTurnId()'),
  2,
  'Both copies need stable turn IDs.'
);

const demoGuardBodies = [
  ...frontend.matchAll(
    /function isRoxDemoSession\(\)\s*\{([\s\S]*?)\r?\n\}/g
  )
].map(match => match[1]);

assert.strictEqual(
  demoGuardBodies.length,
  2,
  'Both clients must define a demo-session guard.'
);

assert(
  demoGuardBodies.every(body =>
    body.includes('session.access_token === DEMO_TOKEN')
  ),
  'Both demo-session guards must avoid unavailable database writes.'
);

assert.strictEqual(
  count("new Set(['chat', 'code', 'images', 'videos', 'roxip'])"),
  2,
  'Both clients must support exactly the five current Rox services.'
);

assert.strictEqual(
  count('const conversations = { chat: [], code: [] };'),
  2,
  'Existing Chat and Code in-memory compatibility must remain.'
);

console.log(
  'PASS: five-service frontend conversation client foundation tests'
);