'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.join(__dirname,'..');

function read(relative){
  const bytes=fs.readFileSync(path.join(root,relative));
  assert.notStrictEqual(bytes.subarray(0,3).toString('hex'),'efbbbf');
  return bytes.toString('utf8').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
}

function count(text,literal){
  return text.split(literal).length-1;
}

const index=read('frontend/index.html');
const css=read('frontend/zuvyr-chat-workspace-v1.css');
const js=read('frontend/zuvyr-chat-workspace-v1.js');

assert.strictEqual(
  count(index,'conversationId:item.id,sequenceNo:message.sequence_no'),
  2,
  'Loaded user messages must carry durable conversation metadata.'
);

assert.strictEqual(
  count(index,'async function sendChat(feature, text, msgBox, userMessage) {'),
  2,
  'Both frontend copies must pass the live user message into sendChat.'
);

assert.strictEqual(
  count(index,'const userSequenceNo=Number(data.conversationMessageCount)-1;'),
  2,
  'Both frontend copies must attach the durable user sequence after success.'
);

assert.strictEqual(count(index,'zuvyr-chat-workspace-v1.css?v=25'),2);
assert.strictEqual(count(index,'zuvyr-chat-workspace-v1.js?v=24'),2);
assert.strictEqual(count(css,'/* ZUVYR USER MESSAGE ACTIONS V1 */'),1);
assert.strictEqual(count(js,'/* ZUVYR USER MESSAGE ACTIONS V1 */'),1);

[
  "copy:'Copy'",
  "share:'Share prompt'",
  "edit:'Edit text'",
  "throughSequence:sequenceNo-1",
  "sendMessage('chat')",
  "message.addEventListener('contextmenu'",
  "setTimeout(()=>{"
].forEach(marker=>{
  assert.ok(js.includes(marker),`Missing user-action marker: ${marker}`);
});

assert.ok(
  css.includes('.zuvyr-user-actions::before'),
  'Desktop user actions must include a hover bridge.'
);

console.log('PASS: ZUVYR user message Copy Share Edit wiring tests');
