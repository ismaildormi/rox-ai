'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const count=(text,needle)=>text.split(needle).length-1;
const index=read('frontend/index.html');
const workspace=read('frontend/zuvyr-chat-workspace-v1.js');
const css=read('frontend/zuvyr-chat-workspace-v1.css');
const server=read('backend/server.js');

assert.strictEqual(count(index,"outputs:[{"),2,'Both history copies must expose output metadata.');
assert.strictEqual(count(index,"outputs: [{"),2,'Both live copies must expose output metadata.');
assert.strictEqual(count(index,"responseId:data.response_message_id||null"),0,'Formatting guard: compact stale marker must not appear.');
assert.strictEqual(count(index,"responseId: data.response_message_id || null"),2,'Both live generation copies must keep the durable response id.');
assert.strictEqual(count(index,"responseId:message.id||null"),2,'Both history copies must keep durable output response identity.');
assert.strictEqual(count(workspace,'/* ZUVYR DURABLE OUTPUTS UI V1 */'),1);
[
  'const collectOutputs=message=>{',
  "const meta=Array.isArray(message?._zuvyrMeta?.outputs)",
  "outputsButton.className='rox-gpt-menu-item zuvyr-outputs-menu-item'",
  'openOutputs(outputs);',
  "type==='audio'||item.type==='music'"
].forEach(marker=>assert.ok(workspace.includes(marker),'Missing Outputs marker: '+marker));
assert.strictEqual(count(css,'/* ZUVYR DURABLE OUTPUTS UI V1 */'),1);
assert.ok(css.includes('.zuvyr-outputs-panel'));
assert.ok(css.includes('.zuvyr-output-preview'));
assert.ok(server.includes('completed_at, response_message_id, user_id'));
assert.ok(index.includes('function createCodeArtifact(rawText)'),'Code Studio output artifacts must remain available.');
console.log('PASS: durable frontend Outputs routing and panel wiring tests');