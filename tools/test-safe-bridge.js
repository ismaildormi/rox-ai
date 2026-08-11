#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const root=path.resolve(__dirname,'..');let fail=0;
function ok(c,m){if(c)console.log('PASS '+m);else{console.error('FAIL '+m);fail++;}}
const required=['ROX-BRIDGE.ps1','ROX-BRIDGE.cmd','ROX-PREFLIGHT.ps1','ROX-PROFILE.ps1','ROX-PROFILE.cmd','ROX-VERIFY-LIVE.ps1','ROX-SMOKE.ps1','ROX-STAGING.ps1','tools/live-smoke.js','frontend/rox-release-guard.js','config/profiles/local.env.template','config/profiles/staging.env.template','config/profiles/production.env.template'];
for(const f of required)ok(fs.existsSync(path.join(root,f)),`exists: ${f}`);
const bridge=fs.readFileSync(path.join(root,'ROX-BRIDGE.ps1'),'utf8');
ok(bridge.includes("@('.git','node_modules','backups','logs','.rox','.vercel','.railway')"),'bridge protects Git/hosting/runtime roots');
ok(bridge.includes("@('backend\\.env','frontend\\rox-config.js','supabase\\.temp')"),'bridge protects secrets/public runtime config/Supabase link state');
ok(bridge.includes('Pushed=$false')&&bridge.includes('Deployed=$false'),'bridge explicitly records no push/deploy');
ok(bridge.includes('ROX-TEST.ps1')&&bridge.includes('Rollback restored'),'bridge validates and rolls back');
const deploy=fs.readFileSync(path.join(root,'ROX-DEPLOY.ps1'),'utf8');
ok(deploy.includes("Type PRODUCTION")&&deploy.includes("-cne 'PRODUCTION'"),'production needs exact typed confirmation');
ok(deploy.includes("Branch -ne 'main'")&&deploy.includes('clean Git working tree'),'production gate checks main and clean tree');
const common=fs.readFileSync(path.join(root,'scripts/windows/ROX.Common.ps1'),'utf8');
ok(common.includes('Get-RoxActiveProfile')&&common.includes('Get-RoxFeatureFlags'),'profile and feature helpers exist');
const index=fs.readFileSync(path.join(root,'frontend/index.html'),'utf8');
ok((index.match(/\.\/rox-release-guard\.js/g)||[]).length===2,'release guard loaded in mobile and desktop');
const cfg=fs.readFileSync(path.join(root,'frontend/rox-config.js'),'utf8');
const cfgExample=fs.readFileSync(path.join(root,'frontend/rox-config.example.js'),'utf8');
ok(cfg.includes('ROX_RUNTIME_CONFIG')&&cfg.includes('PROFILE:')&&cfg.includes('FEATURES:'),'active frontend runtime config has profile and feature gates');
ok(cfgExample.includes("PROFILE: 'local'")&&cfgExample.includes('FEATURES:'),'portable release example defaults to local profile with feature gates');
if(fail)process.exit(1);console.log('\nAll Safe Bridge static checks passed.');
