'use strict';

const assert = require('assert');
const express = require('express');
const {
  createConversationRouter,
  isConversationId
} = require('./lib/conversationRoutes');

const CONVERSATION_ID =
  '11111111-1111-4111-8111-111111111111';

const BRANCH_ID =
  '22222222-2222-4222-8222-222222222222';

async function run() {
  assert.strictEqual(
    isConversationId(CONVERSATION_ID),
    true
  );

  assert.strictEqual(
    isConversationId('not-a-uuid'),
    false
  );

  const calls = [];

  const store = {
    async listConversations(input) {
      calls.push(['list', input]);
      return [{
        id: CONVERSATION_ID,
        feature: 'images',
        title: 'Pinned image ideas'
      }];
    },

    async createConversation(input) {
      calls.push(['create', input]);
      const createCount =
        calls.filter(call => call[0] === 'create').length;

      return {
        id:createCount===1
          ?CONVERSATION_ID
          :BRANCH_ID,
        feature:input.feature,
        title:input.title
      };
    },

    async updateConversation(input) {
      calls.push(['update', input]);
      return {
        id: input.conversationId,
        title: input.title,
        pinned: input.pinned,
        archived: input.archived
      };
    },

    async requireOwnedConversation(conversationId,ownerId) {
      calls.push(['require',{conversationId,ownerId}]);
      return {
        id:conversationId,
        owner_id:ownerId,
        feature:'chat',
        title:'Original chat',
        metadata:{}
      };
    },

    async appendMessage(input) {
      calls.push(['append',input]);
      return {
        id:'branched-message',
        ...input
      };
    },

    async listMessages(input) {
      calls.push(['messages',input]);
      return [{
        id:'message-1',
        sequence_no:1,
        role:'user',
        message_type:'text',
        plain_text:'Hello Rox',
        content:{text:'Hello Rox'},
        metadata:{}
      }];
    }
  };

  const app = express();

  app.use(express.json());

  app.use((req, res, next) => {
    req.userId = 'owner-123';
    next();
  });

  app.use(
    '/api/conversations',
    createConversationRouter({ store })
  );

  const server = await new Promise(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const address = server.address();
  const baseUrl =
    `http://127.0.0.1:${address.port}/api/conversations`;

  try {
    let response = await fetch(
      `${baseUrl}?feature=images&search=logo&archived=false&limit=25`
    );

    assert.strictEqual(response.status, 200);

    let body = await response.json();

    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.items.length, 1);
    assert.strictEqual(calls[0][1].ownerId, 'owner-123');
    assert.strictEqual(calls[0][1].feature, 'images');
    assert.strictEqual(calls[0][1].search, 'logo');

    response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        feature: 'roxip',
        title: 'Secure computer task'
      })
    });

    assert.strictEqual(response.status, 201);

    body = await response.json();

    assert.strictEqual(body.conversation.feature, 'roxip');
    assert.strictEqual(calls[1][1].ownerId, 'owner-123');

    response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        feature: 'unknown'
      })
    });

    assert.strictEqual(response.status, 400);

    response = await fetch(
      `${baseUrl}/${CONVERSATION_ID}`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Important work',
          pinned: true,
          archived: false
        })
      }
    );

    assert.strictEqual(response.status, 200);

    body = await response.json();

    assert.strictEqual(body.conversation.pinned, true);
    assert.strictEqual(calls[2][1].conversationId, CONVERSATION_ID);

    response = await fetch(
      `${baseUrl}/${CONVERSATION_ID}/messages?limit=50`
    );

    assert.strictEqual(response.status, 200);

    body = await response.json();

    assert.strictEqual(body.messages.length, 1);
    assert.strictEqual(calls[3][1].ownerId, 'owner-123');

    response = await fetch(
      `${baseUrl}/${CONVERSATION_ID}/branch`,
      {
        method:'POST',
        headers:{
          'content-type':'application/json'
        },
        body:JSON.stringify({
          throughSequence:1
        })
      }
    );

    assert.strictEqual(response.status,201);

    body=await response.json();

    assert.strictEqual(body.conversation.id,BRANCH_ID);
    assert.strictEqual(body.copiedMessages,1);

    const appendCall=
      calls.find(call=>call[0]==='append');

    assert.strictEqual(
      appendCall[1].conversationId,
      BRANCH_ID
    );

    response = await fetch(
      `${baseUrl}/invalid-id/messages`
    );

    assert.strictEqual(response.status, 400);

    console.log(
      'PASS: unified conversation routes unit tests'
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
