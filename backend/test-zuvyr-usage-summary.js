'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {mountZuvyrUsageSummary,windowSummary}=require('./lib/zuvyrUsageSummary');
const owner='6f3a9c23-c4f2-4fef-8ed1-ae61f94bf758';
const time=Date.parse('2026-09-09T02:00:00Z');
const profile={topup_credits_balance:9,usage_units_total:null,usage_units_used:0,usage_week_units_total:null,usage_week_units_used:0};
async function request({profileError=false,historyError=false,authenticated=true,who=owner}={}){
  let route;const reads=[];
  const auth=(req,res,next)=>authenticated?(req.userId=who,next()):res.status(401).json({status:'error'});
  const db={from(table){let key,value;
    const q={select(fields){assert(!fields.includes('*'));return q;},eq(k,v){key=k;value=v;return q;},order(){return q;},limit(){return q;},single(){return q;},then(resolve,reject){
      reads.push({table,key,value});assert.equal(value,who);assert.equal(key,table==='profiles'?'id':'user_id');
      const result=table==='profiles'?{data:{...profile},error:profileError}:{error:historyError,data:[
        {id:'one',state:'complete',funding_source:'topup',result:{credits:1,text:'PRIVATE PROMPT',providerCost:'PRIVATE COST'},created_at:'2026-09-09T01:34:00Z'},
        {id:'two',state:'quoted',result:null},{id:'three',state:'running',result:{credits:0}}
      ]};return Promise.resolve(result).then(resolve,reject);
    }};return q;
  }};
  mountZuvyrUsageSummary({get(url,...handlers){assert.equal(url,'/api/zuvyr-usage-summary');route=handlers;}},{requireAuth:auth,db,now:()=>time});
  const res={statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this;},status(n){this.statusCode=n;return this;},json(data){this.body=data;return this;}};
  const req={query:{user_id:'someone-else'},body:{userId:'someone-else'}};
  await route[0](req,res,()=>route[1](req,res));return {res,reads};
}
(async()=>{
  let {res,reads}=await request();
  assert.equal(res.body.topupCredits,9);assert.equal(res.body.fiveHour.state,'unconfigured');
  assert.equal(res.body.weekly.remaining,null);assert.equal(reads.length,2);
  assert.equal(res.headers['Cache-Control'],'private, no-store');assert.equal(res.headers.Vary,'Authorization');
  assert.equal(res.body.recentChat[0].creditsCharged,1);assert.equal(res.body.recentChat[1].creditsCharged,null);assert.equal(res.body.recentChat[2].creditsCharged,null);
  assert(!JSON.stringify(res.body).includes('PRIVATE'));assert(!JSON.stringify(res.body).includes(owner));
  console.log('PASS: authenticated owner only, whitelist response, balance 9 and completed charge 1; no writes or RPCs');
  ({res,reads}=await request({authenticated:false}));assert.equal(res.statusCode,401);assert.equal(reads.length,0);
  ({res,reads}=await request({who:null}));assert.equal(res.statusCode,401);assert.equal(reads.length,0);
  console.log('PASS: unauthenticated/missing identity cannot read account data');
  ({res}=await request({profileError:true}));assert.equal(res.statusCode,503);assert.equal(res.body.topupCredits,undefined);
  ({res}=await request({historyError:true}));assert.equal(res.body.topupCredits,9);assert.equal(res.body.recentChatAvailable,false);assert.deepEqual(res.body.recentChat,[]);
  console.log('PASS: unavailable balances never become zero; history failure does not hide valid balance');
  const start='2026-09-09T01:00:00Z',end='2026-09-09T06:00:00Z';
  assert.equal(windowSummary(10,3,start,end,time).remaining,7);
  assert.equal(windowSummary(10,3,start,end,Date.parse(end)).state,'expired');
  assert.equal(windowSummary(10,3,start,end,Date.parse(end)).remaining,null);
  assert.equal(windowSummary(10,3,start,end,Date.parse(start)-1).state,'not_started');
  assert.equal(windowSummary(null,0,null,null,time).state,'unconfigured');
  assert.equal(windowSummary(0,0,start,end,time).remaining,0);
  assert.equal(windowSummary(10,-1,start,end,time).state,'unavailable');
  assert.equal(windowSummary(10,3,'bad',end,time).remaining,null);
  console.log('PASS: null, zero, invalid, future and expired limits remain distinct; no invented renewal');
  // Execute the actual new UI functions with minimal DOM doubles, not a preview page.
  const src=fs.readFileSync(path.join(__dirname,'../frontend/zuvyr-suite-v1.js'),'utf8');
  const fragment=src.slice(src.indexOf('  // Usage UI 10:'),src.indexOf('  function genericView(id)'));
  assert(fragment.length>1000);
  const box={innerHTML:'',textContent:''},button={},title={},intro={};
  const view={querySelector(s){return s==='[data-zs-usage-content]'?box:s==='[data-zs-usage-refresh]'?button:s==='h1'?title:intro;}};
  const context={console,AbortController,setTimeout,clearTimeout,Date,Number,
    document:{documentElement:{lang:'en'}},session:{user:{id:owner}},language:()=> 'en',
    suite:{querySelector:()=>view},esc:v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),window:{}};
  vm.createContext(context);vm.runInContext(fragment,context);
  const success=(await request()).res.body;
  context.window.authFetch=async(url,options)=>{assert.equal(url,'/api/zuvyr-usage-summary');assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');return {ok:true,json:async()=>success};};
  await context.loadUsage();assert.equal(context.usageState,'loaded');assert(box.innerHTML.includes('<strong>9</strong>'));assert(box.innerHTML.includes('Not configured'));assert(box.innerHTML.includes('Final charge: 1 credits'));
  let resolveFirst;context.window.authFetch=()=>new Promise(resolve=>{resolveFirst=resolve;});
  const first=context.loadUsage();context.session={user:{id:'other-user'}};
  context.clearUsage();resolveFirst({ok:true,json:async()=>success});await first;assert.equal(context.usageData,null);assert.notEqual(context.usageState,'loaded');
  context.window.authFetch=async()=>{throw new Error('offline');};await context.loadUsage();assert.equal(context.usageState,'error');assert.equal(context.usageData,null);assert(box.textContent.includes('Could not load'));
  console.log('PASS: real UI functions render live data, discard old-account responses and clear failed/stale data');
  console.log('USAGE UI TEST GROUPS: 5. No live database, provider or payment calls.');
})().catch(e=>{console.error(e);process.exitCode=1;});
