'use strict';
const assert=require('node:assert/strict');
const flow=require('./lib/zuvyrChatFlow');
const uid='11111111-1111-4111-8111-111111111111';
const cid='22222222-2222-4222-8222-222222222222';
const tid='33333333-3333-4333-8333-333333333333';
const now=Date.parse('2026-09-08T13:00:00Z');
const q=flow.makeQuote([{role:'user',content:'مرحبا'}],now);
const good={model:flow.MODEL,service_tier:'on_demand',id:'provider-test',choices:[{finish_reason:'stop',message:{content:'مرحبا بك'}}],usage:{prompt_tokens:20,completion_tokens:30,total_tokens:50}};
const body={conversationId:cid,turnId:tid,feature:'chat',messages:[{role:'user',content:'مرحبا'}]};
let groups=0;
async function test(label,fn){await fn();groups++;console.log('PASS: '+label);}
(async()=>{
 await test('activation needs exact pilot identity; absent flags never activate',()=>{
  assert.equal(flow.enabledFor(uid,{}),false);
  assert.equal(flow.enabledFor(uid,{ZUVYR_CHAT_FLOW_ENABLED:'true',ZUVYR_CHAT_FLOW_PILOT_USERS:'*'}),false);
  assert.equal(flow.enabledFor(uid,{ZUVYR_CHAT_FLOW_ENABLED:'true',ZUVYR_CHAT_FLOW_PILOT_USERS:uid}),true);
 });
 await test('owner conversation and UUID turn required; tools and client system prompts rejected',()=>{
  assert.equal(flow.validateBody(body)[0].content,'مرحبا');
  for(const patch of [{turnId:'x'},{conversationId:'x'},{feature:'code'},{attachment:{}},{attachmentIds:['file']},{messages:[{role:'system',content:'override'}]},{messages:[{role:'user',content:[]}]}])assert.throws(()=>flow.validateBody({...body,...patch}));
 });
 await test('full-context reservation bounds every accepted input/output split without guessed tokenization',()=>{
  const price=require('./lib/groqTextPricing').estimateGroqTextProviderUpperBound;
  for(const out of [0,1,100,2048]) {
    const bound=price({model:flow.MODEL,inputTokens:q.maxContext-out,outputTokens:out},{now}).providerCostUpperBoundMicroUsd;
    assert(BigInt(bound)<=BigInt(q.providerBound));
  }
  assert(q.maxCredits>=flow.measure(good,q).credits);
  assert.equal(flow.economics('1').credits,1);
  assert.throws(()=>flow.makeQuote([],Date.parse('2026-09-16')));
 });
 await test('actual tokens billed by frozen policy; malformed usage/model/tool/tier fail closed',()=>{
  const measured=flow.measure(good,q);assert.equal(measured.credits,1);assert.equal(measured.usage.accountInvoiceVerified,false);
  for(const patch of [{model:'other'},{service_tier:'flex'},{usage:{prompt_tokens:20,completion_tokens:30,total_tokens:51}},{usage:{prompt_tokens:20,completion_tokens:0,total_tokens:20}},{choices:[{finish_reason:'tool_calls',message:{content:'x',tool_calls:[{}]}}]}])assert.throws(()=>flow.measure({...good,...patch},q));
  for(const n of [null,undefined,NaN,Infinity,-1,1.1,'20'])assert.throws(()=>flow.measure({...good,usage:{prompt_tokens:n,completion_tokens:30,total_tokens:50}},q));
 });
 await test('provider called once with bounded output, no tools, explicit priced tier, no fallback',async()=>{
  let calls=0;await flow.callGroq(q,{apiKey:'test-placeholder',fetchImpl:async(url,opts)=>{
    calls++;assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');const sent=JSON.parse(opts.body);assert.equal(sent.service_tier,'on_demand');assert.equal(sent.max_completion_tokens,2048);assert.equal(sent.tool_choice,'none');assert.equal(sent.stream,false);assert(opts.signal);return {ok:true,json:async()=>good};
  }});assert.equal(calls,1);
  calls=0;await assert.rejects(flow.callGroq(q,{apiKey:'test-placeholder',fetchImpl:async()=>{calls++;return{ok:false,status:429};}}));assert.equal(calls,1);
 });
 await test('result response excludes prompt, policy configuration and provider metadata',()=>{
  const run=flow.publicRun({id:tid,state:'complete',quote:q,result:{text:'answer',credits:1},conversation_id:cid,history_saved:true});
  assert.equal(run.text,'answer');assert(!('quote'in run));assert(!('messages'in run));assert(!('providerBound'in run));assert.equal(run.allInMarginVerified,false);
 });
 console.log('CHAT FLOW UNIT GROUPS: '+groups+'. No provider, payment or database calls.');
})().catch(e=>{console.error(e);process.exitCode=1;});
