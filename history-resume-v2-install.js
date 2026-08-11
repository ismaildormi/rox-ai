const fs = require('fs');

const p = 'frontend/index.html';
let s = fs.readFileSync(p, 'utf8');

const anchor = 'async function loadRoxHistory(){';
const anchorCount = s.split(anchor).length - 1;

if (anchorCount !== 2) {
  console.error('STOP: expected exactly 2 History loaders, found ' + anchorCount);
  process.exit(1);
}

const helper = `function openRoxHistoryItem(item){
  if(!item || !item.content || typeof item.content !== 'object') return;

  const content = item.content;
  const feature = String(content.feature || 'chat').toLowerCase() === 'code'
    ? 'code'
    : 'chat';

  const savedMessages = Array.isArray(content.messages)
    ? content.messages
    : [];

  const assistant =
    content.assistant && typeof content.assistant === 'object'
      ? content.assistant
      : null;

  const transcript = savedMessages
    .filter(message =>
      message &&
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string' &&
      message.content.trim()
    )
    .map(message => ({
      role: message.role,
      content: message.content
    }));

  if(
    assistant &&
    typeof assistant.content === 'string' &&
    assistant.content.trim()
  ){
    transcript.push({
      role: 'assistant',
      content: assistant.content,
      responseId: assistant.responseId || null,
      model: assistant.model || null
    });
  }

  conversations[feature] = transcript
    .slice(-CHAT_HISTORY_LIMIT)
    .map(message => ({
      role: message.role,
      content: message.content
    }));

  const msgBox = document.getElementById('msgs-' + feature);
  const featureView = document.getElementById('feature-' + feature);
  const historyView = document.getElementById('feature-history');

  if(!msgBox || !featureView) return;

  msgBox.innerHTML = '';

  transcript.forEach(message => {
    const isAssistant = message.role === 'assistant';

    appendMsg(
      msgBox,
      isAssistant ? 'bot' : 'user',
      message.content,
      false,
      isAssistant
        ? {
            responseId: message.responseId || null,
            model: message.model || null,
            feature
          }
        : {}
    );
  });

  if(historyView){
    historyView.classList.remove('active');
  }

  featureView.classList.add('active');
  msgBox.scrollTop = msgBox.scrollHeight;

  const input = document.querySelector(
    'input[data-feature="' + feature + '"]'
  );

  if(input){
    setTimeout(() => input.focus(), 0);
  }
}

function bindRoxHistoryRows(target, items){
  target.querySelectorAll('[data-rox-history-id]').forEach(row => {
    row.style.cursor = 'pointer';

    row.addEventListener('click', () => {
      const id = String(row.dataset.roxHistoryId || '');

      const item = items.find(
        candidate => String(candidate?.id || '') === id
      );

      if(item){
        openRoxHistoryItem(item);
      }
    });
  });
}

`;

s = s.split(anchor).join(helper + anchor);

const oldRender = `    targets.forEach(target=>{
      target.innerHTML=html;
    });`;

const renderCount = s.split(oldRender).length - 1;

if (renderCount !== 2) {
  console.error(
    'STOP: expected exactly 2 History render targets, found ' +
    renderCount
  );
  process.exit(1);
}

const newRender = `    targets.forEach(target=>{
      target.innerHTML=html;
      bindRoxHistoryRows(target, items);
    });`;

s = s.split(oldRender).join(newRender);

fs.writeFileSync(p, s, 'utf8');

console.log('OK: History Resume V2 installed for Mobile + Desktop only.');
