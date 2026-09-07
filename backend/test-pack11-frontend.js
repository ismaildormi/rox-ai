'use strict';
const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path');
const read=relative=>fs.readFileSync(path.join(__dirname,'..',relative),'utf8');
const index=read('frontend/index.html'), js=read('frontend/zuvyr-suite-v1.js'), css=read('frontend/zuvyr-suite-v1.css');
assert(index.includes('/zuvyr-suite-v1.css')); assert(index.includes('/zuvyr-suite-v1.js')); assert(index.includes('suiteBody + deviceWatcher'));
for(const marker of ['ZUVYR IP','Code Studio','Usage & Billing','Spreadsheets','Presentations','Scheduled','Plugins','data-zs-plan-form','data-zs-ip-form']) assert(js.includes(marker),`Missing UI ${marker}`);
assert(js.includes("'/api/unified-product/orchestration/plan'")); assert(js.includes("'/api/unified-product/ip/plan'")); assert(!js.includes('innerHTML=form.goal.value'));
assert(css.includes('@media (max-width:768px)')); assert(css.includes('@media (prefers-reduced-motion:reduce)')); assert(css.includes(':focus-visible'));
console.log('PASS: Pack 11 responsive ZUVYR Suite is injected without replacing existing AI Chat');
