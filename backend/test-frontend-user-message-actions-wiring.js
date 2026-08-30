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

assert.strictEqual(count(index,'zuvyr-chat-workspace-v1.css?v=28'),2);
assert.strictEqual(count(index,'zuvyr-chat-workspace-v1.js?v=28'),2);
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

assert.strictEqual(
  count(index,'var roxActiveChatRequests = window.roxActiveChatRequests || new Map();'),
  2,
  'Both frontend copies must track active chat requests.'
);
assert.strictEqual(
  count(index,'signal: controller.signal,'),
  2,
  'Both frontend copies must pass an abort signal to chat.'
);
assert.strictEqual(
  count(index,'if(stopRoxChatRequest(btn.dataset.send))return;'),
  2,
  'Both send buttons must stop an active request.'
);
assert.strictEqual(
  count(js,'toast(text.copied);'),
  1,
  'Only the Share fallback may use the copied toast.'
);
assert.ok(js.includes("check:'<svg"),'Copy must include the check icon.');
assert.ok(
  js.includes('const wrapped = async function(feature,text,msgBox,userMessage)'),
  'Attachment wrapper must preserve the user message.'
);
assert.ok(
  js.includes('original.call(this,feature,outgoingText,msgBox,userMessage)'),
  'Attachment wrapper must forward the user message.'
);
assert.ok(
  css.includes('/* ZUVYR COPY CHECK + CHAT STOP V1 */'),
  'Copy and Stop styles must exist.'
);

console.log('PASS: ZUVYR user message Copy Share Edit wiring tests');
