/* ZUVYR Chat Flow 07: attached to the existing mobile/desktop Chat. */
(function () {
  'use strict';
  const ar = /^(ar|ary)/i.test(document.documentElement.lang || navigator.language || '') || document.documentElement.dir === 'rtl';
  const t = (a, e) => ar ? a : e;
  const pendingKey = 'zuvyr-chat-flow-07-pending';
  let active = false;
  function pending() { try { return JSON.parse(sessionStorage.getItem(pendingKey) || '[]').filter(x => /^[a-f0-9-]{36}$/i.test(x)).slice(-8); } catch (_) { return []; } }
  function remember(id, remove) { try { sessionStorage.setItem(pendingKey, JSON.stringify([...new Set(pending().filter(x=>x!==id).concat(remove?[]:[id]))].slice(-8))); } catch (_) {} }
  function element(tag, text) { const el = document.createElement(tag); if (text) el.textContent = text; return el; }
  function button(text, primary) { const b=element('button',text);b.type='button';b.style.cssText='padding:12px 18px;border-radius:10px;border:1px solid #60554a;color:#fff;cursor:pointer;background:'+(primary?'#b84b00':'#24211e');return b; }
  function dialog(title) {
    const d=element('dialog');d.setAttribute('aria-label',title);d.style.cssText='box-sizing:border-box;width:min(94vw,480px);max-height:85vh;overflow:auto;border:1px solid #74604b;border-radius:18px;background:#131313;color:#f4f1ec;padding:24px;font:16px/1.6 system-ui;';d.dir=ar?'rtl':'ltr';
    const h=element('h2',title);h.style.marginTop='0';d.append(h);document.body.append(d);const focused=document.activeElement;
    d.showModal();return {d,close(){d.close();d.remove();if(focused?.isConnected)focused.focus();}};
  }
  function consent(run, signal) {
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise(resolve=>{
      const modal=dialog(t('تأكيد استهلاك Chat','Confirm Chat usage'));
      modal.d.append(element('p',t('الحد الأقصى للحجز: ','Maximum reservation: ')+run.maxCredits+t(' كريديت.',' credits.')));
      modal.d.append(element('p',t('التكلفة النهائية حسب توكنات الطلب والجواب، مع حصة مصاريف الخدمة. الفرق كيرجع بعد اكتمال العملية.','The final charge uses request and response tokens plus the service cost allocation. Unused credits are returned after completion.')));
      modal.d.append(element('p',t('رصيد الاشتراك أولاً. يمكن رفض الطلب إذا الرصيد أو الحدود ما كافياش.','Subscription allowance is used first. Insufficient or unconfigured limits may prevent execution.')));
      const label=element('label');label.style.display='block';const topup=element('input');topup.type='checkbox';label.append(topup,document.createTextNode(t(' نسمح باستعمال Top-up إلا ما كفاش حد الاشتراك.',' Allow Top-up if the subscription allowance cannot cover this request.')));modal.d.append(label);
      modal.d.append(element('p',t('من بعد الإرسال، زر التوقف كيطلب الإلغاء وإرجاع الحجز. غلق الصفحة بوحده ما كيلغيش العملية.','After sending, Stop requests cancellation and a refund. Closing the page alone does not cancel the operation.')));
      const controls=element('div');controls.style.cssText='display:flex;gap:12px;margin-top:20px;flex-wrap:wrap';const no=button(t('إلغاء','Cancel'));const yes=button(t('موافقة وإرسال','Approve and send'),true);controls.append(no,yes);modal.d.append(controls);
      let done=false;
      const finish=value=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);modal.close();resolve(value);};
      const abort=()=>finish(null);signal?.addEventListener('abort',abort,{once:true});
      no.onclick=()=>finish(null);yes.onclick=()=>finish({accepted:true,allowTopup:topup.checked,maxCredits:run.maxCredits,policyHash:run.policyHash});
      modal.d.addEventListener('cancel',event=>{event.preventDefault();finish(null);});no.focus();
    });
  }
  function response(data,status) { return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}); }
  async function request(fetcher,path,options) { const res=await fetcher(path,options);const data=await res.json();if(!res.ok)throw Object.assign(new Error(data.message||data.code||'Chat unavailable'),{data,status:res.status});return data; }
  async function waitForResult(fetcher,run) {
    for(let i=0;i<60 && ['running','result_ready','refund_ready'].includes(run.state);i++) {
      if(run.requiresReview)break;
      await new Promise(resolve=>setTimeout(resolve,2000));
      run=await request(fetcher,'/api/zuvyr-chat/'+run.id,{method:'GET'});
    }
    return run;
  }
  function showReceipt(run) {
    const modal=dialog(t('نتيجة Chat','Chat result'));
    if(run.state==='complete') {
      const p=element('p',run.text);p.style.whiteSpace='pre-wrap';modal.d.append(p);
      modal.d.append(element('p',t('المستهلك: ','Used: ')+run.creditsCharged+t(' كريديت؛ المرجع: ',' credits; reference: ')+run.id));
    } else modal.d.append(element('p',run.message || t('العملية ما زالت كتتعالج. ما تعاودش التوليد؛ استرجعها من نفس الزر.','This operation is still processing. Recover it using this button instead of generating again.')));
    const close=button(t('إغلاق','Close'));close.onclick=()=>modal.close();modal.d.append(close);
  }
  function recoveryBanner() {
    const ids=pending();let banner=document.getElementById('zuvyr-chat-flow-recovery');if(banner)banner.remove();if(!ids.length)return;
    banner=element('aside');banner.id='zuvyr-chat-flow-recovery';banner.style.cssText='position:fixed;bottom:16px;right:16px;z-index:10000;max-width:90vw;background:#191714;color:white;padding:12px;border:1px solid #b47843;border-radius:12px;';
    const b=button(t('استرجاع عملية Chat','Recover Chat operation'));banner.append(b);document.body.append(banner);
    b.onclick=async()=>{if(typeof window.authFetch!=='function')return;b.disabled=true;try {
      const run=await request(window.authFetch,'/api/zuvyr-chat/'+ids[0],{method:'GET'});
      if(['complete','refunded','cancelled'].includes(run.state))remember(run.id,true);
      showReceipt(run);recoveryBanner();
    }catch(e){if(e.status===404)remember(ids[0],true);b.textContent=e.message;}finally{b.disabled=false;}};
  }
  window.zuvyrChatConsent=async function(initial, _path, options, fetcher){
    const data=await initial.clone().json();if(data.code!=='zuvyr_chat_consent_required')return initial;
    if(active)return response({message:t('كمّل العملية الحالية أولاً.','Finish the current operation first.')},409);
    active=true;let run=data.run;let cancelListener;
    try {
      if(run.state==='quoted') {
        const approval=await consent(run,options.signal);
        if(!approval) {
          await request(fetcher,'/api/zuvyr-chat/'+run.id+'/cancel',{method:'POST',body:'{}'});
          return response({message:t('تلغى الطلب قبل التوليد؛ ما تقطع حتى كريديت.','Cancelled before generation. No credits were charged.')},409);
        }
        remember(run.id,false);recoveryBanner();
        // Cancellation is a durable server flag; closing a socket alone is not.
        cancelListener=()=>{request(fetcher,'/api/zuvyr-chat/'+run.id+'/cancel',{method:'POST',body:'{}'}).catch(()=>{});};
        options.signal?.addEventListener('abort',cancelListener,{once:true});
        if(options.signal?.aborted)cancelListener();
        run=await request(fetcher,'/api/zuvyr-chat/'+run.id+'/execute',{method:'POST',body:JSON.stringify(approval)});
      }
      run=await waitForResult(fetcher,run);
      if(['complete','refunded','cancelled'].includes(run.state))remember(run.id,true);
      recoveryBanner();
      if(run.state==='complete')return response(run,200);
      if(run.state==='refunded')return response(run,502);
      return response({message:t('النتيجة ما زالت قيد المعالجة. استعمل زر استرجاع العملية.','The result is still processing. Use Recover Chat operation.'),runId:run.id},409);
    } catch(e) {return response({message:e.message,code:e.data?.code||'chat_recovery_available'},e.status||503);}
    finally {if(cancelListener)options.signal?.removeEventListener('abort',cancelListener);active=false;recoveryBanner();}
  };
  recoveryBanner();
})();
