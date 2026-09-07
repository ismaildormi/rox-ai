(function () {
  'use strict';
  if (window.__zuvyrSuiteV1Loaded) return;
  window.__zuvyrSuiteV1Loaded = true;

  var sections = [
    ['dashboard','⌂','Dashboard','ready'],['images','◇','Images','connect'],['video','▷','Video','connect'],
    ['code','</>','Code Studio','ready'],['voice','◉','Voice','connect'],['music','♫','Music','connect'],
    ['ip','✦','ZUVYR IP','plan'],['research','⌕','Research','connect'],['library','▦','Library','ready'],
    ['projects','▣','Projects','ready'],['documents','▤','Documents','ready'],['spreadsheets','▥','Spreadsheets','ready'],
    ['presentations','▧','Presentations','ready'],['scheduled','◷','Scheduled','blocked'],['plugins','⌘','Plugins','blocked'],
    ['usage','◫','Usage & Billing','ready'],['analytics','⌁','Analytics','validate'],['settings','⚙','Settings','ready']
  ];
  var copy = {
    dashboard:['Connected workspace','Turn one goal into a coordinated workflow across ZUVYR.'],
    images:['Images','Generate, edit, upscale and organize visual assets after a verified provider is connected.'],
    video:['Video','Plan text-to-video, image-to-video, editing, subtitles and export in one job surface.'],
    code:['Code Studio','Build multi-file projects and request approved image or video assets when the experience needs them.'],
    voice:['Voice','Prepare transcription, speech and voice conversations with transparent minute usage.'],
    music:['Music & Audio','Create music, effects, cleanup and remix workflows after pricing is verified.'],
    ip:['ZUVYR IP','Plan work across every ZUVYR capability with exact permissions, audit and STOP controls.'],
    research:['Research','Plan web search, deep research and shopping with sources and handoffs.'],
    library:['Library','Find and organize images, documents, media and generated outputs.'],
    projects:['Projects','Keep chats, files, media, code and task context together.'],
    documents:['Documents','Draft, review and prepare export-ready documents with source awareness.'],
    spreadsheets:['Spreadsheets','Structure data, formulas, analysis and chart-ready results.'],
    presentations:['Presentations','Turn approved outlines, documents and media into coherent slides.'],
    scheduled:['Scheduled Tasks','Prepare one-time and recurring tasks. Execution remains disabled until notification safety is verified.'],
    plugins:['Plugins','Discover integrations and inspect required permissions before installation is enabled.'],
    usage:['Usage & Billing','Keep subscription allowance, weekly limits and persistent top-up credits visibly separate.'],
    analytics:['Analytics','Review product usage and financial signals after production data validation.'],
    settings:['Settings','Manage language, appearance, privacy, devices, billing and data controls.']
  };

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]; }); }
  function statusLabel(state) { return state === 'ready' ? 'Foundation ready' : state === 'plan' ? 'Planning only' : state === 'validate' ? 'Validate data' : state === 'blocked' ? 'Safety blocked' : 'Connect provider'; }
  function navHtml() {
    var groups = [['Workspace',sections.slice(0,10)],['Create & manage',sections.slice(10,15)],['Account',sections.slice(15)]];
    return groups.map(function (group) {
      return '<div class="zs-nav-title">'+group[0]+'</div><nav class="zs-nav">'+group[1].map(function (s) {
        return '<button type="button" data-zs-nav="'+s[0]+'"><span class="zs-nav-icon">'+s[1]+'</span><span>'+s[2]+'</span>'+(s[3] === 'connect' || s[3] === 'blocked' ? '<i class="zs-nav-badge" aria-hidden="true"></i>' : '')+'</button>';
      }).join('')+'</nav>';
    }).join('');
  }
  function heading(id) {
    var item = sections.find(function (s) { return s[0] === id; });
    var state = item ? item[3] : 'connect';
    return '<div class="zs-heading"><div><div class="zs-eyebrow">ZUVYR / '+esc(copy[id][0])+'</div><h1>'+esc(copy[id][0])+'</h1><p>'+esc(copy[id][1])+'</p></div><span class="zs-status '+(state === 'ready' ? 'ready' : '')+'">'+statusLabel(state)+'</span></div>';
  }
  function orchestrator(id) {
    var defaults = id === 'code' ? 'Create a premium website with animated video and original images' : 'Describe the result you want ZUVYR to coordinate';
    return '<div class="zs-card wide"><h2>Cross-feature project</h2><p>ZUVYR proposes an ordered workflow. Media creation requires your permission and execution stays blocked until provider pricing is verified.</p><form data-zs-plan-form><div class="zs-field"><label for="zs-goal-'+id+'">Goal</label><textarea id="zs-goal-'+id+'" name="goal" placeholder="'+esc(defaults)+'"></textarea></div><div class="zs-checks">'+
      ['research','images','video','audio','code','documents','presentations','project'].map(function (o) { return '<label class="zs-check"><input type="checkbox" name="outputs" value="'+o+'" '+(id === 'code' && ['research','images','video','code','project'].indexOf(o)>-1?'checked':'')+'> '+o.charAt(0).toUpperCase()+o.slice(1)+'</label>'; }).join('')+
      '</div><label class="zs-consent"><input type="checkbox" name="consent"> I explicitly allow ZUVYR to include any selected image, video or audio creation in this proposal. No credits are spent by planning.</label><div class="zs-actions"><button class="zs-primary" type="submit">Build safe plan</button><span class="zs-hint">Proposal only · No provider call · No credit charge</span></div></form><div class="zs-result" data-zs-plan-result></div></div>';
  }
  function toolCards(id) {
    var maps = {
      images:[['Generate','Prompt, reference, ratio and resolution'],['Edit','Variations, inpainting and expand'],['Enhance','Remove background, upscale and repair']],
      video:[['Generate','Text or image to video'],['Jobs','Queue, progress, preview and cancel'],['Edit & export','Extend, subtitles and enhance']],
      voice:[['Transcribe','Speech to text with minute tracking'],['Speak','Text to speech and voice selection'],['Voice chat','Transcript, waveform and STOP']],
      music:[['Music','Prompt, duration and variants'],['Audio tools','Cleanup, remix and stems'],['Audio to video','Scenes, subtitles and export']],
      research:[['Web Search','Live sources and citations'],['Deep Research','Multi-round plan and verification'],['Shopping','Products, prices and specs']],
      library:[['All assets','Search, filters and folders'],['Uploads','Documents, images and media'],['Handoffs','Send approved assets to projects']],
      projects:[['Project context','Chat, files, media and code'],['Task handoffs','Ordered cross-feature outputs'],['History','Decisions, versions and results']],
      documents:[['Editor','Write, edit and comment'],['Sources','Citations and linked files'],['Delivery','Review and export']],
      spreadsheets:[['Data','Tables, imports and cleanup'],['Analysis','Formulas and validation'],['Charts','Visual summaries and export']],
      presentations:[['Outline','Narrative and slide structure'],['Design','Templates, media and layouts'],['Export','Review and delivery']],
      scheduled:[['Schedule','Once or recurring'],['History','Runs and notifications'],['Controls','Pause and delete']],
      plugins:[['Discover','Search the marketplace'],['Permissions','Inspect requested access'],['Connections','Connect or disconnect']],
      analytics:[['Usage','7 and 30 day views'],['Cost','Provider and feature cost'],['Margin','Revenue, profit and risk reserve']],
      settings:[['Account','Profile, language and appearance'],['Privacy','Memory and data controls'],['Billing','Plan, payment and invoices']]
    };
    return '<div class="zs-tool-grid">'+(maps[id] || []).map(function (t) { return '<article class="zs-tool"><div class="zs-tool-top"><span class="zs-tool-icon">✦</span><span class="zs-tool-state">'+(sections.find(function(s){return s[0]===id;})[3] === 'ready' ? 'foundation' : 'connect')+'</span></div><h3>'+t[0]+'</h3><p>'+t[1]+'</p></article>'; }).join('')+'</div>';
  }
  function dashboard() {
    return heading('dashboard')+'<div class="zs-banner"><span>✦</span><div><b>One goal, connected capabilities.</b> ZUVYR passes approved research and assets into the next step instead of isolating every tool.</div></div><div class="zs-grid">'+
      orchestrator('dashboard')+
      '<div class="zs-card"><h2>5-hour allowance</h2><p>Subscription wallet</p><div class="zs-kpi"><strong>—</strong><span>Connect live usage</span></div><div class="zs-progress"><span style="width:0%"></span></div></div>'+
      '<div class="zs-card half"><h2>Capability network</h2><p>Approved results move between tools through explicit handoffs.</p><div class="zs-orbit"><div><div class="zs-orbit-core">ZUVYR</div><div class="zs-orbit-list"><span class="zs-chip">Research → Code</span><span class="zs-chip">Images → Code</span><span class="zs-chip">Audio → Video</span><span class="zs-chip">Library → Projects</span></div></div></div></div>'+
      '<div class="zs-card half"><h2>Launch safety</h2><p>These foundations are visible without pretending unavailable providers are live.</p><div class="zs-chip-row"><span class="zs-chip">Unknown price: blocked</span><span class="zs-chip">Extra media: consent</span><span class="zs-chip">Credits: reserve first</span><span class="zs-chip">IP device control: off</span></div></div></div>';
  }
  function ipView() {
    var scopes=['chat.read','images.propose','video.propose','audio.propose','code.propose','research.propose','library.read','projects.propose','documents.propose','spreadsheets.propose','presentations.propose','scheduled_tasks.propose','plugins.read'];
    return heading('ip')+'<div class="zs-grid"><div class="zs-card wide"><h2>Permission-scoped tool plan</h2><p>Select exactly what ZUVYR IP may include. Wildcards, shell, filesystem writes and device control are unavailable.</p><form data-zs-ip-form><div class="zs-field"><label for="zs-ip-goal">Goal</label><textarea id="zs-ip-goal" name="goal" placeholder="Plan a multi-step project across ZUVYR"></textarea></div><div class="zs-checks">'+scopes.map(function(s){return '<label class="zs-check"><input type="checkbox" name="scopes" value="'+s+'"> '+s+'</label>';}).join('')+'</div><label class="zs-consent"><input type="checkbox" name="consent"> I approve these exact planning scopes. This does not approve device control, provider calls or spending.</label><div class="zs-actions"><button class="zs-primary" type="submit">Create IP plan</button><span class="zs-hint">Audit + STOP required</span></div></form><div class="zs-result" data-zs-ip-result></div></div><div class="zs-card"><h2>Safety core</h2><div class="zs-chip-row"><span class="zs-chip">Exact scopes</span><span class="zs-chip">Confirmation</span><span class="zs-chip">Live audit</span><span class="zs-chip">STOP</span><span class="zs-chip">Undo plan</span></div><p class="zs-note">Computer control remains disabled until a trusted device agent and rollback evidence exist.</p></div></div>';
  }
  function usageView() {
    return heading('usage')+'<div class="zs-grid"><div class="zs-card"><h2>5-hour limit</h2><div class="zs-kpi"><strong>—</strong><span>Live data pending</span></div><div class="zs-progress"><span style="width:0%"></span></div></div><div class="zs-card"><h2>Weekly limit</h2><div class="zs-kpi"><strong>—</strong><span>Live data pending</span></div><div class="zs-progress"><span style="width:0%"></span></div></div><div class="zs-card"><h2>Top-up credits</h2><div class="zs-kpi"><strong>—</strong><span>Persistent wallet</span></div><p class="zs-note">Top-up is never spent silently after subscription allowance ends.</p></div><div class="zs-card full"><div class="zs-empty"><div><strong>Billing controls are intentionally inactive</strong>Connect verified plan limits, Stripe period and production ledger before activation.</div></div></div></div>';
  }
  function genericView(id) {
    var state=sections.find(function(s){return s[0]===id;})[3];
    var extra=id==='code'?orchestrator('code'):toolCards(id);
    return heading(id)+'<div class="zs-banner"><span>◎</span><div><b>'+(state==='ready'?'Interface foundation is ready.':'Ready to connect safely.')+'</b> '+(state==='ready'?'Use the existing backend foundation and connect verified data next.':'Provider execution stays off until pricing, limits and settlement pass verification.')+'</div></div>'+extra;
  }
  function viewHtml(id) { if(id==='dashboard')return dashboard(); if(id==='ip')return ipView(); if(id==='usage')return usageView(); return genericView(id); }

  var launcher=document.createElement('button');
  launcher.type='button';launcher.className='zuvyr-suite-launcher';launcher.setAttribute('aria-label','Open ZUVYR Suite');
  launcher.innerHTML='<span class="zuvyr-suite-launcher-mark">Z</span><span class="zuvyr-suite-launcher-label">Open ZUVYR Suite</span>';
  var suite=document.createElement('section');suite.className='zuvyr-suite';suite.setAttribute('aria-hidden','true');suite.setAttribute('data-open','false');
  suite.innerHTML='<aside class="zs-sidebar"><div class="zs-brand"><div class="zs-brand-mark">Z</div><div><strong>ZUVYR</strong><small>Connected Intelligence</small></div></div>'+navHtml()+'</aside><main class="zs-main"><header class="zs-topbar"><button type="button" class="zs-top-action zs-mobile-menu" data-zs-menu aria-label="Menu">☰</button><label class="zs-search"><span>⌕</span><input data-zs-search placeholder="Search ZUVYR capabilities" aria-label="Search capabilities"></label><button type="button" class="zs-top-action" data-zs-chat>Existing AI Chat</button><button type="button" class="zs-top-action zs-close" data-zs-close aria-label="Close">×</button></header><div class="zs-content">'+sections.map(function(s){return '<section class="zs-view" data-zs-view="'+s[0]+'">'+viewHtml(s[0])+'</section>';}).join('')+'</div></main><div class="zs-toast" role="status" aria-live="polite"></div>';
  document.body.appendChild(launcher);document.body.appendChild(suite);

  var toastTimer;
  function toast(message){var el=suite.querySelector('.zs-toast');el.textContent=message;el.dataset.visible='true';clearTimeout(toastTimer);toastTimer=setTimeout(function(){el.dataset.visible='false';},3400);}
  function open(){suite.dataset.open='true';suite.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';show('dashboard');}
  function close(){suite.dataset.open='false';suite.dataset.menu='false';suite.setAttribute('aria-hidden','true');document.body.style.overflow='';launcher.focus();}
  function show(id){suite.querySelectorAll('[data-zs-view]').forEach(function(v){v.dataset.active=String(v.dataset.zsView===id);});suite.querySelectorAll('[data-zs-nav]').forEach(function(b){if(b.dataset.zsNav===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});suite.dataset.menu='false';suite.querySelector('.zs-main').scrollTop=0;}
  function request(path, options){if(typeof window.authFetch==='function')return window.authFetch(path,options);return fetch(path,options);}
  function checked(form,name){return Array.prototype.slice.call(form.querySelectorAll('input[name="'+name+'"]:checked')).map(function(i){return i.value;});}
  function renderPlan(el,plan){el.dataset.visible='true';el.innerHTML='<div class="zs-result-title">✦ Safe proposal ready</div><p>No provider call or credit charge was made.</p><div class="zs-step-list">'+plan.steps.map(function(s,i){return '<div class="zs-step"><span class="zs-step-num">'+(i+1)+'</span><div><strong>'+esc(s.title)+'</strong><small>'+esc(s.capability)+' · proposed · execution off</small></div></div>';}).join('')+'</div>';}
  async function planSubmit(form){var result=form.parentNode.querySelector('[data-zs-plan-result]');var body={goal:form.goal.value,requestedOutputs:checked(form,'outputs'),additionalCreationConsent:form.consent.checked};try{var res=await request('/api/unified-product/orchestration/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});var data=await res.json();if(!res.ok)throw new Error(data.code||'plan_failed');renderPlan(result,data.plan);}catch(error){result.dataset.visible='true';result.innerHTML='<div class="zs-result-title">Planning needs attention</div><p>'+esc(error.message==='additional_creation_consent_required'?'Approve selected media creation to include it in the plan.':error.message)+'</p>';}}
  async function ipSubmit(form){var result=form.parentNode.querySelector('[data-zs-ip-result]');var body={goal:form.goal.value,scopes:checked(form,'scopes'),explicitConsent:form.consent.checked};try{var res=await request('/api/unified-product/ip/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});var data=await res.json();if(!res.ok)throw new Error(data.code||'ip_plan_failed');result.dataset.visible='true';result.innerHTML='<div class="zs-result-title">✦ IP tool plan ready</div><p>'+data.plan.scopes.map(esc).join(' · ')+'</p><div class="zs-chip-row"><span class="zs-chip">Execution off</span><span class="zs-chip">Device control off</span><span class="zs-chip">Audit required</span><span class="zs-chip">STOP available</span></div>';}catch(error){result.dataset.visible='true';result.innerHTML='<div class="zs-result-title">Permission check</div><p>'+esc(error.message)+'</p>';}}
  launcher.addEventListener('click',open);suite.addEventListener('click',function(e){var nav=e.target.closest('[data-zs-nav]');if(nav)show(nav.dataset.zsNav);if(e.target.closest('[data-zs-close]'))close();if(e.target.closest('[data-zs-menu]'))suite.dataset.menu=String(suite.dataset.menu!=='true');if(e.target.closest('[data-zs-chat]')){close();var chat=document.querySelector('[data-open="chat"], [data-tab="chat"], #nav-chat');if(chat)chat.click();else toast('AI Chat stays in the existing ZUVYR interface.');}});
  suite.addEventListener('submit',function(e){if(e.target.matches('[data-zs-plan-form]')){e.preventDefault();planSubmit(e.target);}if(e.target.matches('[data-zs-ip-form]')){e.preventDefault();ipSubmit(e.target);}});
  suite.querySelector('[data-zs-search]').addEventListener('input',function(e){var term=e.target.value.trim().toLowerCase();if(!term)return;var hit=sections.find(function(s){return s[2].toLowerCase().indexOf(term)>-1||s[0].indexOf(term)>-1;});if(hit)show(hit[0]);});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&suite.dataset.open==='true')close();});
})();
