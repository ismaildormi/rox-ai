'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const read = relative => fs.readFileSync(path.join(__dirname,'..',relative),'utf8');
const server=read('backend/server.js'); const routes=read('backend/lib/unifiedProductRoutes.js'); const flags=JSON.parse(read('backend/config/feature-flags.json'));
for (const marker of ["'/api/unified-product'",'requireAuth',"rateLimit('workspace')",'createUnifiedProductRouter()']) assert(server.includes(marker),`Missing ${marker}`);
for (const marker of ["router.get('/catalog'","router.post('/orchestration/plan'","router.post('/orchestration/approve'","router.post('/ip/plan'"]) assert(routes.includes(marker),`Missing ${marker}`);
assert.equal(flags.unified_product_ui.enabled,true); assert.equal(flags.cross_feature_planning.enabled,true); assert.equal(flags.cross_feature_execution.enabled,false); assert.equal(flags.zuvyr_ip_tool_planning.enabled,true); assert.equal(flags.zuvyr_ip_tool_execution.enabled,false);
console.log('PASS: Pack 11 authenticated routes and fail-closed execution flags are wired');
