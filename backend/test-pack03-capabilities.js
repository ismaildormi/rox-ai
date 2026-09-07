'use strict';

const assert = require('node:assert/strict');
const { normalizeChatMode, isModeEnabled, assertChatModeAvailable } = require('./lib/chatCapabilities');

assert.equal(normalizeChatMode(), 'standard');
assert.equal(assertChatModeAvailable('standard', { env: {} }).capability, 'chat');
assert.equal(isModeEnabled('web_search', {}), false);
assert.throws(() => assertChatModeAvailable('web_search', { env: { ZUVYR_WEB_SEARCH_ENABLED: 'true' } }), error => error.code === 'chat_mode_unpriced');
assert.throws(() => assertChatModeAvailable('deep_research'), error => error.code === 'chat_mode_unpriced');
assert.throws(() => assertChatModeAvailable('shopping'), error => error.code === 'chat_mode_unpriced');
assert.throws(() => normalizeChatMode('unknown'), error => error.code === 'unknown_chat_mode');

console.log('PASS: Pack 03 standard Chat remains available and unpriced external modes fail closed');
