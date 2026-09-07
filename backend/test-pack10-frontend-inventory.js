'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const frontend = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
const config = require('./config/final-product.v1.json');
for (const id of ['dashboard','chat','images','video','code','zuvyr_ip','library_projects','usage_billing','settings']) {
  const marker = config.interfaces[id].sourceMarker;
  assert(marker && frontend.includes(marker), `Missing existing frontend marker ${id}:${marker}`);
}
assert.equal(config.interfaces.voice_audio.sourceMarker, null);
assert.equal(config.interfaces.voice_audio.status, 'backend_foundation_no_dedicated_surface');
assert(frontend.includes('Demo — not connected to the backend yet'));
assert(frontend.includes('@media'));
assert(frontend.includes('prefers-reduced-motion'));
assert(frontend.includes('data-i18n'));
assert(frontend.includes('aria-label'));
assert(config.interfaceOrder.every(id => config.interfaces[id].productionVerified === false));
console.log('PASS: Pack 10 inventories existing responsive/i18n/accessibility markers without claiming live UI completion');
