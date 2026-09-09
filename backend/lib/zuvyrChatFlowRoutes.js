'use strict';
const { enabledFor, createService } = require('./zuvyrChatFlow');
function mountZuvyrChatFlow(app, {requireAuth, rateLimit, db, memory, preferences, env = process.env}) {
  require('./zuvyrUsageSummary').mountZuvyrUsageSummary(app,{requireAuth,db});
  const service = createService({db,memory,preferences,env});
  const limit = rateLimit('chat');
  if(env.ZUVYR_CHAT_FLOW_RECOVERY_ENABLED === 'true') {
    let sweeping=false;
    const sweep=async()=>{if(sweeping)return;sweeping=true;try{await service.recoverPending();}catch(_){}finally{sweeping=false;}};
    const timer=setInterval(sweep,60000);timer.unref();sweep();
  }
  const wrap = fn => async (req,res,next) => {
    try { await fn(req,res,next); }
    catch(e) { res.status(e.status||503).json({code:e.code||'chat_temporarily_unavailable',message:e.status?e.message:'Chat is temporarily unavailable. Retry the same operation.'}); }
  };
  // Mounted before legacy /api/chat. Eligibility never depends on browser data.
  app.post('/api/chat',requireAuth,(req,res,next)=>enabledFor(req.userId,env)&&(!req.body.feature||req.body.feature==='chat')?Promise.resolve(limit(req,res,next)).catch(next):next(),wrap(async(req,res,next)=>{
    if (!enabledFor(req.userId,env) || (req.body.feature && req.body.feature!=='chat')) return next();
    const run = await service.quote(req.userId,req.body);
    res.status(428).json({code:'zuvyr_chat_consent_required',run});
  }));
  app.post('/api/zuvyr-chat/:id/execute',requireAuth,rateLimit('chat'),wrap(async(req,res)=>{
    const run=await service.execute(req.userId,req.params.id,req.body);
    res.json(run);
  }));
  app.post('/api/zuvyr-chat/:id/cancel',requireAuth,wrap(async(req,res)=>res.json(await service.cancel(req.userId,req.params.id))));
  app.get('/api/zuvyr-chat-readiness',requireAuth,wrap(async(req,res)=>{
    const {policyHash,VERSION}=require('./zuvyrChatFlow');
    const {error}=await db.from('zuvyr_chat_flows').select('id',{head:true,count:'exact'});
    res.set('Cache-Control','no-store');res.json({version:VERSION,commit:env.RAILWAY_GIT_COMMIT_SHA||null,
      schemaAvailable:!error,pilotEligible:enabledFor(req.userId,env),
      policyAcknowledged:env.ZUVYR_CHAT_FLOW_POLICY_ACK===policyHash(),
      recoveryEnabled:env.ZUVYR_CHAT_FLOW_RECOVERY_ENABLED==='true',
      databaseIdentityConfirmed:!!env.SUPABASE_URL&&env.ZUVYR_CHAT_FLOW_DATABASE_URL===env.SUPABASE_URL});
  }));
  app.get('/api/zuvyr-chat/:id',requireAuth,wrap(async(req,res)=>{
    res.set('Cache-Control','no-store');res.json(await service.finish(req.userId,req.params.id));
  }));
}
module.exports={mountZuvyrChatFlow};
