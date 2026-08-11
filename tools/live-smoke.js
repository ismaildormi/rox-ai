#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
function envFile(file){ const out={}; if(!fs.existsSync(file)) return out; for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){ const t=line.trim(); if(!t||t.startsWith('#')) continue; const i=t.indexOf('='); if(i>0) out[t.slice(0,i).trim()]=t.slice(i+1).trim(); } return out; }
const env={...envFile(path.join(root,'backend','.env')),...process.env};
const api=String(env.PUBLIC_API_BASE||'http://127.0.0.1:3001').replace(/\/$/,'');
const app=String(env.APP_URL||'http://127.0.0.1:5500').replace(/\/$/,'');
const token=String(env.ROX_SMOKE_ACCESS_TOKEN||'');
const authenticated=process.argv.includes('--authenticated');
const results=[];
async function check(name,fn){ try{ const detail=await fn(); results.push({name,status:'PASS',detail}); console.log(`PASS ${name} | ${detail}`); }catch(e){ results.push({name,status:'FAIL',detail:e.message}); console.error(`FAIL ${name} | ${e.message}`); } }
async function request(url,opts={}){ const c=new AbortController(); const timer=setTimeout(()=>c.abort(),12000); try{return await fetch(url,{...opts,signal:c.signal});}finally{clearTimeout(timer);} }
(async()=>{
 await check('Frontend document',async()=>{const r=await request(app); const t=await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}`); if(!/Rox AI/i.test(t)) throw new Error('ROX marker missing'); return `HTTP ${r.status}`;});
 await check('Backend health',async()=>{const r=await request(`${api}/healthz`); const j=await r.json().catch(()=>({})); if(r.status!==200) throw new Error(`HTTP ${r.status}`); return `${r.status} ${j.status||''}`.trim();});
 await check('CORS preflight',async()=>{const r=await request(`${api}/api/chat`,{method:'OPTIONS',headers:{Origin:app,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}}); const allow=r.headers.get('access-control-allow-origin'); if(![200,204].includes(r.status)) throw new Error(`HTTP ${r.status}`); if(allow!=='*'&&allow!==app) throw new Error(`origin not allowed (${allow||'missing'})`); return `HTTP ${r.status}`;});
 for(const endpoint of ['/api/chat','/api/generate-image','/api/generate-video']){
   await check(`Auth guard ${endpoint}`,async()=>{const r=await request(api+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}); if(![401,403].includes(r.status)) throw new Error(`expected 401/403, got ${r.status}`); return `HTTP ${r.status}`;});
 }
 if(authenticated){
   if(!token){results.push({name:'Authenticated chat',status:'FAIL',detail:'ROX_SMOKE_ACCESS_TOKEN is missing'}); console.error('FAIL Authenticated chat | ROX_SMOKE_ACCESS_TOKEN is missing');}
   else await check('Authenticated chat',async()=>{const r=await request(`${api}/api/chat`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({feature:'chat',messages:[{role:'user',content:'Reply exactly ROX_SMOKE_OK'}]})}); const text=await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0,180)}`); if(!/ROX_SMOKE_OK/i.test(text)) throw new Error('expected marker not found'); return `HTTP ${r.status}`;});
 }
 const failed=results.filter(x=>x.status==='FAIL').length; const report={checkedAt:new Date().toISOString(),api,app,authenticated,results,failed}; fs.mkdirSync(path.join(root,'logs'),{recursive:true}); const out=path.join(root,'logs',`smoke-${Date.now()}.json`); fs.writeFileSync(out,JSON.stringify(report,null,2)); console.log(`REPORT ${out}`); process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exit(1);});
