'use strict';
// Read-only account view. Never reserve, settle, reset windows or call a provider.
const PROFILE_FIELDS = 'topup_credits_balance,usage_units_total,usage_units_used,usage_window_started_at,usage_window_ends_at,usage_week_units_total,usage_week_units_used,usage_week_started_at,usage_week_ends_at';
const RUN_FIELDS = 'id,state,funding_source,result,created_at,finished_at';
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
function windowSummary(total, used, start, end, now) {
  total = integer(total); used = integer(used);
  const begins = typeof start === 'string' ? Date.parse(start) : NaN;
  const ends = typeof end === 'string' ? Date.parse(end) : NaN;
  const validDates = Number.isFinite(begins) && Number.isFinite(ends) && ends > begins;
  const state = total === null ? 'unconfigured' : used === null || !validDates ? 'unavailable' : begins > now ? 'not_started' : ends <= now ? 'expired' : 'active';
  return {state,total,used,remaining:state === 'active' ? Math.max(0,total-used) : null,
    startedAt:validDates ? new Date(begins).toISOString() : null,
    endsAt:validDates ? new Date(ends).toISOString() : null};
}
function publicRun(row) {
  // Explicit whitelist: never expose prompts, result text, provider costs or policy.
  return {id:row.id,state:row.state,fundingSource:row.funding_source,
    creditsCharged:row.state === 'complete' ? integer(row.result && row.result.credits) : row.state === 'refunded' || row.state === 'cancelled' ? 0 : null,
    createdAt:row.created_at,finishedAt:row.finished_at};
}
function mountZuvyrUsageSummary(app,{requireAuth,db,now=Date.now}) {
  app.get('/api/zuvyr-usage-summary',requireAuth,async(req,res)=>{
    res.set('Cache-Control','private, no-store');
    res.set('Vary','Authorization');
    // Defense in depth: client query/body identifiers are never used.
    if(!req.userId) return res.status(401).json({status:'error',code:'authentication_required'});
    try {
      const profile = await db.from('profiles').select(PROFILE_FIELDS).eq('id',req.userId).single();
      if(profile.error || !profile.data) throw new Error('profile_unavailable');
      const p=profile.data;
      const time=now();
      let runs={data:null,error:true};
      try {
        runs=await db.from('zuvyr_chat_flows').select(RUN_FIELDS).eq('user_id',req.userId).order('created_at',{ascending:false}).limit(10);
      } catch (_) { /* Balance remains useful if recent history is unavailable. */ }
      res.json({status:'success',version:'usage-ui-10.v1',checkedAt:new Date(time).toISOString(),
        topupCredits:integer(p.topup_credits_balance),
        fiveHour:windowSummary(p.usage_units_total,p.usage_units_used,p.usage_window_started_at,p.usage_window_ends_at,time),
        weekly:windowSummary(p.usage_week_units_total,p.usage_week_units_used,p.usage_week_started_at,p.usage_week_ends_at,time),
        recentChatAvailable:!runs.error && Array.isArray(runs.data),
        recentChat:!runs.error && Array.isArray(runs.data) ? runs.data.map(publicRun) : []});
    } catch (_) {
      res.status(503).json({status:'error',code:'usage_unavailable',message:'Usage could not be loaded. Please retry.'});
    }
  });
}
module.exports={mountZuvyrUsageSummary,windowSummary,publicRun};
