'use strict';
const { spawnSync }=require('node:child_process'); const path=require('node:path');
const tests=['test-pack11-registry.js','test-pack11-orchestration.js','test-pack11-ip.js','test-pack11-wiring.js','test-pack11-frontend.js','test-pack11-database.js','test-pack11-no-activation.js','test-pack10.js'];
for(const test of tests){const result=spawnSync(process.execPath,[path.join(__dirname,test)],{encoding:'utf8',env:{PATH:process.env.PATH,NODE_PATH:process.env.NODE_PATH||''}});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.status!==0)process.exit(result.status||1);}
console.log(`PASS: ${tests.length} Pack 11 cumulative Unified Product regression runners`);
console.log('EXTERNAL NETWORK / PROVIDER / BILLING / CREDIT / DEVICE / DEPLOY / STORE / DATABASE CALLS: NONE');
