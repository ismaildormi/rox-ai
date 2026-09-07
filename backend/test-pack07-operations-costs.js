'use strict';
const assert = require('node:assert/strict');
const { validateRegistry } = require('./lib/costRegistry');
const { config, normalizeAudioOperation, assertAudioOperationAvailable, providerSupports, publicInventory } = require('./lib/audioOperationRegistry');

validateRegistry();
assert.equal(config.version, 'pack-07.audio-system.v1');
for (const operation of ['transcription','text_to_speech','voice_chat','music_generation','sound_effects','audio_cleanup','remix','stem_separation','translate_dub','audio_to_video']) {
  assert.equal(normalizeAudioOperation(operation.toUpperCase()), operation);
  assert.equal(config.operations[operation].enabledByDefault, false);
  assert.throws(() => assertAudioOperationAvailable(operation), { code: 'audio_operation_unpriced' });
  for (const provider of Object.keys(config.providers)) assert.equal(providerSupports(provider, operation), false);
}
assert.equal(publicInventory().localCapabilities.browser_dictation.enabledByDefault, true);
assert.equal(publicInventory().voicePrivacy.continuousListeningEnabledByDefault, false);
const registry = require('./config/cost-registry.v1.json');
const audioEntries = registry.entries.filter(entry => entry.id.startsWith('unassigned-audio') || entry.id === 'unassigned-voice-chat' || entry.id === 'unassigned-music-generation');
assert.equal(audioEntries.length, 6);
for (const entry of audioEntries) {
  assert.equal(entry.enabledState, 'blocked');
  assert.equal(entry.verificationStatus, 'unverified');
  assert.equal(entry.creditConversionResult, null);
  assert.equal(entry.targetGrossMarginBps, 5000);
}
console.log('PASS: Pack 07 registry covers all audio operations and blocks every unpriced provider');
