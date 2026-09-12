'use strict';
const crypto = require('node:crypto');
const { estimateGroqTextProviderUpperBound: price } = require('./groqTextPricing');
const catalog = require('../config/groq-text-pricing.verified.v1.json');
const policy = require('../config/usage-policy.v1.json');
const MODEL = 'openai/gpt-oss-20b';
const OUTPUT = 2048;
const VERSION = 'chat-flow-07.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(code, status = 409) { const e = new Error(code); e.code = code; e.status = status; throw e; }
function integer(v, name) { if (!Number.isSafeInteger(v) || v < 0) fail('invalid_' + name, 502); return v; }
function ceil(a, b) { return (a + b - 1n) / b; }
function economics(cost, e = policy.economics) {
  // Policy allocation, NOT an invoice or a verified all-in profit margin.
  for (const k of ['creditValueMicroUsd', 'infrastructureReserveMicroUsd', 'minimumChargeCredits']) {
    if (!/^[0-9]{1,12}$/.test(String(e[k]))) fail('invalid_credit_policy', 503);
  }
  for (const k of ['targetGrossMarginBps','providerCostReserveBps','retryFailureReserveBps','currencyChangeReserveBps']) {
    if (!Number.isSafeInteger(e[k]) || e[k] < 0 || e[k] >= 10000) fail('invalid_credit_policy', 503);
  }
  const unit = BigInt(e.creditValueMicroUsd);
  if (!unit || BigInt(e.minimumChargeCredits) < 1n) fail('invalid_credit_policy', 503);
  const allocated = ceil(BigInt(cost) * BigInt(10000 + e.providerCostReserveBps + e.retryFailureReserveBps + e.currencyChangeReserveBps), 10000n) + BigInt(e.infrastructureReserveMicroUsd);
  const credits = [BigInt(e.minimumChargeCredits), ceil(allocated * 10000n, BigInt(10000 - e.targetGrossMarginBps) * unit)].reduce((a,b)=>a>b?a:b);
  if (credits > 100000n) fail('credit_quote_too_large', 503);
  return { credits: Number(credits), allocatedMicroUsd: allocated.toString(), creditValueMicroUsd: unit.toString() };
}
function policyHash() { return crypto.createHash('sha256').update(JSON.stringify({version: VERSION, economics: policy.economics, catalog})).digest('hex'); }
function enabledFor(userId, env = process.env) {
  return env.ZUVYR_CHAT_FLOW_ENABLED === 'true' && UUID.test(userId || '') &&
    String(env.ZUVYR_CHAT_FLOW_PILOT_USERS || '').split(',').map(x=>x.trim()).includes(userId);
}
function ready(env = process.env) {
  if (env.ZUVYR_CHAT_FLOW_POLICY_ACK !== policyHash()) fail('chat_policy_review_required', 503);
  if (!env.GROQ_API_KEY) fail('groq_key_missing', 503);
  // Explicit match prevents configuring this path against an accidental project.
  if (env.ZUVYR_CHAT_FLOW_DATABASE_URL !== env.SUPABASE_URL || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(env.SUPABASE_URL || '')) fail('database_identity_not_confirmed', 503);
  price({model:MODEL,inputTokens:1,outputTokens:OUTPUT});
}
function validateBody(body) {
  if (!body || body.feature && body.feature !== 'chat' || body.attachment || (body.attachmentIds && (!Array.isArray(body.attachmentIds) || body.attachmentIds.length)) || body.chatMode && body.chatMode !== 'chat') fail('text_chat_only', 422);
  if (!UUID.test(body.conversationId || '') || !UUID.test(body.turnId || '')) fail('conversation_and_turn_required', 422);
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100) fail('invalid_messages', 422);
  let size = 0;
  const messages = body.messages.map(m => {
    if (!m || !['user','assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim()) fail('text_messages_required', 422);
    size += Buffer.byteLength(m.content, 'utf8');
    return {role:m.role,content:m.content};
  });
  if (size > 64000 || messages.at(-1).role !== 'user') fail('text_chat_size_limit', 422);
  return messages;
}
function makeQuote(messages, now = Date.now()) {
  // Reserve the entire permitted context, not a guessed tokenizer count.
  // Any accepted no-tool request has input + completion <= model context.
  // This bounds cost even if a provider accepts fewer output tokens than cap.
  const context = Number(catalog.models[MODEL].maxContextTokens);
  const inputBound = context - OUTPUT;
  const estimate = price({model:MODEL,inputTokens:inputBound,outputTokens:OUTPUT}, {now});
  const charges = economics(estimate.providerCostUpperBoundMicroUsd);
  return { version:VERSION, model:MODEL, maxOutput:OUTPUT, maxContext:context, messages,
    pricingVersion:estimate.pricingVersion, policyHash:policyHash(), economics:policy.economics,
    maxCredits:charges.credits, providerBound:estimate.providerCostUpperBoundMicroUsd,
    createdAt:new Date(now).toISOString(), expiresAt:new Date(Math.min(now + 300000, Date.parse(estimate.reviewBefore))).toISOString() };
}
function measure(data, quote) {
  if (!data || data.model !== quote.model || !['on_demand','default'].includes(data.service_tier) || !Array.isArray(data.choices) || data.choices.length !== 1) fail('provider_response_unverified', 502);
  const choice = data.choices[0];
  if (!choice || !['stop','length'].includes(choice.finish_reason) || !choice.message || choice.message.tool_calls?.length || typeof choice.message.content !== 'string' || !choice.message.content.trim()) fail('provider_result_invalid', 502);
  const input = integer(data.usage?.prompt_tokens,'prompt_tokens');
  const output = integer(data.usage?.completion_tokens,'completion_tokens');
  if (input === 0 || output === 0) fail('provider_empty_usage',502);
  if (integer(data.usage?.total_tokens,'total_tokens') !== input + output || output > quote.maxOutput || input + output > quote.maxContext) fail('provider_usage_outside_quote',502);
  const cost = price({model:quote.model,inputTokens:input,outputTokens:output},{now:Date.parse(quote.createdAt)}).providerCostUpperBoundMicroUsd;
  if (BigInt(cost) > BigInt(quote.providerBound)) fail('provider_cost_outside_quote',502);
  const charge = economics(cost, quote.economics);
  if (charge.credits > quote.maxCredits) fail('charge_outside_quote',502);
  return { text:choice.message.content, model:quote.model, credits:charge.credits, cost,
    usage:{prompt_tokens:input,completion_tokens:output,total_tokens:input+output,
      costBasis:'published_uncached_rate_upper_bound',accountInvoiceVerified:false,allInMarginVerified:false,
      revenueBasis:'nominal_credit_value_not_recognized_revenue',allocatedCostMicroUsd:charge.allocatedMicroUsd,providerResponseId:typeof data.id==='string'?data.id:null,finishReason:choice.finish_reason} };
}
async function callGroq(quote, {fetchImpl = global.fetch, apiKey = process.env.GROQ_API_KEY} = {}) {
  if (!apiKey) fail('groq_key_missing',503);
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 90000);
  try {
    const response = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST', signal:controller.signal,
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},
      body:JSON.stringify({model:quote.model,messages:quote.messages,max_completion_tokens:quote.maxOutput,
        service_tier:'on_demand',stream:false,n:1,reasoning_effort:'low',reasoning_format:'hidden',tool_choice:'none'})
    });
    if (!response.ok) fail('provider_http_' + response.status,502);
    return measure(await response.json(), quote);
  } finally { clearTimeout(timer); }
}
function createService({db,memory,preferences,env = process.env,provider = callGroq}) {
  async function rpc(name,args) {
    const {data,error} = await db.rpc(name,args);
    if (error) fail('chat_storage_unavailable',503);
    if (!data?.success) fail(data?.error || 'chat_operation_rejected', data?.error?.includes('insufficient')?402:409);
    return data;
  }
  async function row(owner,id) {
    if (!UUID.test(id || '')) fail('invalid_run_id',422);
    const {data,error} = await db.from('zuvyr_chat_flows').select('*').eq('id',id).eq('user_id',owner).maybeSingle();
    if (error) fail('chat_storage_unavailable',503);
    if (!data) fail('chat_run_not_found',404);
    return data;
  }
  async function quote(owner,body) {
    ready(env);
    const messages = validateBody(body);
    const c = await memory.requireOwnedConversation(body.conversationId,owner);
    if (c.feature !== 'chat') fail('conversation_feature_mismatch',409);
    if (Number(c.message_count) >= 998) fail('conversation_message_limit',409);
    const context = await memory.buildConversationContext({conversationId:body.conversationId,ownerId:owner});
    const prompt = 'You are ZUVYR, a helpful multilingual assistant. Answer in the user\'s language. You cannot run tools or generate media in this text-only request.';
    const prefs = preferences.buildTextPreferencePrompt(preferences.normalizeAiPreferences(body.aiPreferences), 'chat');
    const frozen = [{role:'system',content:prompt + '\n' + (prefs || '')}, ...context.messages, messages.at(-1)];
    if (Buffer.byteLength(JSON.stringify(frozen),'utf8') > 128000) fail('text_chat_size_limit',422);
    const q = makeQuote(frozen);
    q.messageCount = Number(context.conversation.message_count);
    const hash = crypto.createHash('sha256').update(JSON.stringify({conversationId:body.conversationId,messages,aiPreferences:body.aiPreferences||{}})).digest('hex');
    const result = await rpc('zuvyr_chat_create_quote',{p_user_id:owner,p_conversation_id:body.conversationId,p_turn_id:body.turnId,p_payload_hash:hash,p_quote:q});
    return publicRun(result.run);
  }
  async function finish(owner,id) {
    // Recovery is allowed with activation OFF. It cannot call a provider.
    const r = await row(owner,id);
    if (['running','result_ready','refund_ready'].includes(r.state)) await rpc('zuvyr_chat_finalize',{p_user_id:owner,p_id:id});
    const fresh = await row(owner,id);
    if (fresh.state === 'complete' && !fresh.history_saved) {
      try {
        await memory.appendMessage({conversationId:fresh.conversation_id,ownerId:owner,role:'user',plainText:fresh.quote.messages.at(-1).content,requestId:id+':user'});
        const m = await memory.appendMessage({conversationId:fresh.conversation_id,ownerId:owner,role:'assistant',plainText:fresh.result.text,model:fresh.quote.model,provider:'groq',requestId:id+':assistant',metadata:{responseId:id}});
        const {error} = await db.from('zuvyr_chat_flows').update({history_saved:true,message_count:Number(m?.sequence_no)||null}).eq('id',id).eq('user_id',owner);
        if (!error) { fresh.history_saved=true;fresh.message_count=Number(m?.sequence_no)||null; }
      } catch (_) { /* Durable result remains retrievable; retry history without generating. */ }
    }
    return publicRun(fresh);
  }
  async function execute(owner,id,consent) {
    const previous = await row(owner,id);
    if (previous.state !== 'quoted') return finish(owner,id);
    if (!enabledFor(owner,env)) fail('chat_pilot_disabled',503);
    ready(env);
    if (consent?.accepted !== true || typeof consent?.allowTopup !== 'boolean' || consent?.maxCredits !== previous.quote.maxCredits || consent?.policyHash !== previous.quote.policyHash) fail('explicit_matching_consent_required',422);
    if (previous.quote.policyHash !== policyHash()) fail('quote_policy_changed',409);
    const claim = await rpc('zuvyr_chat_claim',{p_user_id:owner,p_id:id,p_allow_topup:consent.allowTopup});
    if (!claim.claimed) return finish(owner,id);
    let outcome;
    try { outcome = {kind:'success',...await provider(previous.quote)}; }
    catch (error) {
      // Customer receives full refund. Conservatively allocate the maximum
      // provider exposure; do NOT claim unknown timeout costs were zero.
      outcome = {kind:'failure',code:/^provider_|^invalid_/.test(error.code||'')?error.code:'provider_connection_failed',credits:0,cost:previous.quote.providerBound,
        usage:{costBasis:'conservative_exposure_bound',accountInvoiceVerified:false,allInMarginVerified:false,providerUsageKnown:false}};
    }
    // Never place the provider inside a retry loop. Only persist the SAME result.
    let saved = false;
    for (let attempt=0;attempt<3 && !saved;attempt++) {
      try { await rpc('zuvyr_chat_save_result',{p_user_id:owner,p_id:id,p_result:outcome});saved=true; }
      catch (_) { /* next attempt writes the identical result, never re-generates */ }
    }
    if (!saved) fail('result_persistence_requires_review',503);
    return finish(owner,id);
  }
  async function cancel(owner,id) { await rpc('zuvyr_chat_cancel',{p_user_id:owner,p_id:id});return finish(owner,id); }
  async function recoverPending() {
    const {data,error}=await db.from('zuvyr_chat_flows').select('id,user_id')
      .in('state',['running','result_ready','refund_ready']).order('created_at',{ascending:true}).limit(20);
    if(error) return {scanned:0,available:false};
    for(const item of data||[]) { try { await finish(item.user_id,item.id); } catch(_) { /* next sweep resumes settlement only */ } }
    return {scanned:(data||[]).length,available:true};
  }
  return {quote,execute,finish,cancel,recoverPending};
}
function publicRun(r) {
  const q=r.quote;
  return {meteredChat:true,id:r.id,state:r.state,model:q.model,maxCredits:q.maxCredits,policyHash:q.policyHash,expiresAt:q.expiresAt,
    fundingSource:r.funding_source||null,creditsCharged:r.state==='complete'?r.result.credits:0,
    creditsReserved:['running','result_ready','refund_ready'].includes(r.state)?q.maxCredits:0,
    creditsRefunded:['complete','refunded'].includes(r.state)?q.maxCredits-(r.result?.credits||0):0,
    ...(r.state==='complete'?{status:'success',text:r.result.text,responseId:r.id,conversationId:r.conversation_id,memorySaved:r.history_saved,conversationMessageCount:r.message_count,sources:[]}:{}),
    ...(r.state==='refunded'?{code:r.result?.code||'chat_failed_refunded',message:'Chat failed. The full reservation was returned.'}:{}),
    cancelRequested:!!r.cancel_requested,
    requiresReview:r.state==='running' && Date.now()-Date.parse(r.started_at)>360000,
    pricingBasis:'token_usage_with_reviewed_policy_allocation',allInMarginVerified:false};
}
module.exports={VERSION,MODEL,OUTPUT,enabledFor,ready,validateBody,makeQuote,measure,economics,policyHash,callGroq,createService,publicRun};
