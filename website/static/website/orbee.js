/* Claude requests go through Django; API keys never enter this browser. */
(() => {
  const root=document.getElementById('orbee-chat');if(!root)return;
  const launcher=document.getElementById('orbee-launcher'),widget=document.getElementById('orbee-widget');
  const log=document.getElementById('orbee-messages'),form=document.getElementById('orbee-chat-form'),input=document.getElementById('orbee-question');
  const localize=()=>window.TerraGrowI18n?.refresh(root);
  const topics={
    crop:{title:'Crop advice',answer:'Compare crop requirements with the environmental records for your saved field. Open Crop to see suitability scores, missing soil checks and planting windows.',path:'crops'},
    weather:{title:'Weather',answer:'Explore rainfall, temperature and wind records for your saved pin in NASA data. Historical patterns describe the past; they do not predict the exact day it will rain.',path:'nasa'},
    soil:{title:'Soil & water',answer:'Soil wetness describes water conditions, not soil fertility. Open NASA data for dated surface and root-zone readings. Soil pH, nutrients and drainage still need local checks.',path:'nasa'},
    rotation:{title:'Crop rotation',answer:'Review your previous, next and following crops on the Crop page. Your saved rotation is a plan, separate from crop suitability rankings. Edit it in Field settings.',path:'crops'},
    market:{title:'Market information',answer:'Compare the spreadsheet’s per-kilogram reference prices in Market. Switch between kip, baht and dollars, or try the income calculator. Ask a local buyer for a current quote.',path:'market'},
    disease:{title:'Plant health',answer:'Satellite images cannot diagnose a crop disease. Record the affected leaves and when symptoms began, and ask a local agricultural adviser. Alerts shows the available environmental indicators.',path:'alerts'}
  };
  const rules=[['rotation',/rotat|sequence|หมุนเวียน|ໝູນວຽນ/iu],['market',/market|price|income|cost|kip|baht|usd|thb|lak|ราคา|ตลาด|รายได้|ລາຄາ|ຕະຫຼາດ|ລາຍໄດ້/iu],['disease',/disease|pest|sick|insect|โรค|แมลง|ພະຍາດ|ແມງ/iu],['soil',/soil|water|moist|irrigat|ดิน|น้ำ|ດິນ|ນ້ຳ|ຊຸ່ມ/iu],['weather',/rain|weather|wind|temperat|forecast|ฝน|อากาศ|ลม|ຝົນ|ອາກາດ|ລົມ/iu],['crop',/crop|plant|grow|rice|maize|coffee|cassava|พืช|ปลูก|ພືດ|ປູກ/iu]];
  let greetingTimer,lastTopic,ai=false,busy=false,history=[],contextPin=null,contextVersion=0;
  const aiStatus=document.getElementById('orbee-ai-status'),privacy=document.getElementById('orbee-ai-privacy');
  const connectionLabel=document.getElementById('orbee-connection-label'),setup=document.getElementById('orbee-setup');
  let connection;
  function checkConnection(){
    connection=fetch('/api/orbee/chat/',{cache:'no-store',signal:AbortSignal.timeout(5000)})
      .then(response=>response.ok?response.json():Promise.reject()).then(data=>{
        ai=data.status==='ready';connectionLabel.textContent=ai?'Claude configured':'AI offline · app guide only';
        connectionLabel.dataset.mode=ai?'ready':'offline';setup.hidden=ai;
        const updated=data.reply_style==='conversational-v2'&&data.response_policy==='multilingual-v1';
        aiStatus.textContent=ai?(updated?'Powered by Claude · check important advice locally.':'Restart the server to load the updated Orbee explanations.'):'Claude is not connected to this server. Typed questions need the AI connection.';
        if(ai&&!updated)setup.hidden=false;
        privacy.hidden=!ai;localize();return ai;
      }).catch(()=>{ai=false;connectionLabel.textContent='AI connection unavailable';connectionLabel.dataset.mode='offline';setup.hidden=false;privacy.hidden=true;aiStatus.textContent='Claude connection unavailable. Topic-guide replies are available.';localize();return false;});
    return connection;
  }
  checkConnection();
  function greet(){
    clearTimeout(greetingTimer);widget?.classList.remove('orbee-is-greeting');
    const portrait=document.querySelector('.orbee-portrait');portrait?.classList.remove('is-greeting');
    requestAnimationFrame(()=>{widget?.classList.add('orbee-is-greeting');portrait?.classList.add('is-greeting');});
    greetingTimer=setTimeout(()=>{widget?.classList.remove('orbee-is-greeting');portrait?.classList.remove('is-greeting');},2200);
  }
  function setOpen(open,focus=true){
    if(!launcher)return;
    root.hidden=!open;launcher.setAttribute('aria-expanded',String(open));
    if(open){greet();if(focus)input.focus({preventScroll:true});log.scrollTop=log.scrollHeight;}
    else if(focus)launcher.focus({preventScroll:true});
  }
  launcher?.addEventListener('click',()=>setOpen(root.hidden));
  document.getElementById('orbee-close')?.addEventListener('click',()=>setOpen(false));
  root.addEventListener('keydown',event=>{if(event.key==='Escape'&&launcher){event.preventDefault();setOpen(false);}});
  if(launcher){
    document.addEventListener('click',event=>{if(!root.hidden&&!widget.contains(event.target))setOpen(false,false);});
    const observer=new MutationObserver(()=>{if(!root.hidden&&document.querySelector('dialog[open]'))setOpen(false,false);});
    document.querySelectorAll('dialog').forEach(dialog=>observer.observe(dialog,{attributes:true,attributeFilter:['open']}));
  }
  function make(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
  function appendUser(question,userEntered){
    const user=make('div');user.className='orbee-message orbee-message-user';const message=make('p',question);if(userEntered)message.dataset.noTranslate='';user.append(message);log.append(user);
  }
  function linkToPage(link){
    link.addEventListener('click',event=>{
      const nav=document.querySelector('.sidebar nav a[href="'+link.getAttribute('href')+'"]');
      if(nav){event.preventDefault();nav.click();}
    });
  }
  function trim(){while(log.children.length>21)log.children[1].remove();localize();log.scrollTop=log.scrollHeight;}
  function guide(question,topic,userEntered=false){
    appendUser(question,userEntered);
    ['orbee-title','orbee-answer','orbee-link'].forEach(id=>document.getElementById(id)?.removeAttribute('id'));
    const reply=make('div');reply.className='orbee-message orbee-message-bot is-new';
    if(topic){
      const item=topics[topic],title=make('h3',item.title),answer=make('p',item.answer),link=make('a','Explore your field →');
      title.id='orbee-title';answer.id='orbee-answer';link.id='orbee-link';link.href='/workspace/'+item.path+'/';
      // Dynamic links use the same one-visit guest grant as deliberate sidebar navigation.
      linkToPage(link);
      reply.append(title,answer,link);lastTopic=topic;
    }else{
      reply.append(make('p','I can guide you to crop, weather, soil, rotation, market and plant-health information. Choose a topic below so I can point you to the right page.'));lastTopic=null;
    }
    const badge=make('small','App guide');reply.prepend(badge);
    log.append(reply);trim();
    root.querySelectorAll('[data-orbee]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.orbee===lastTopic)));
    localize();log.scrollTop=log.scrollHeight;greet();
  }
  const errors={not_configured:'Claude is not connected yet. The app owner needs to connect the API key.',access_required:'Claude access needs attention. The app owner should check the API key and workspace.',billing_required:'The Claude API account needs billing attention.',model_unavailable:'The configured Claude model is unavailable. The app owner should check the model setting.',request_rejected:'Claude could not accept this request. Check API credits and model settings, then try again.',rate_limited:'Too many messages right now. Please wait a little and try again.',busy:'Orbee is busy with another reply. Please try again shortly.',pin_changed:'Your field changed while Orbee was replying. Please ask again for the new location.',unavailable:'Claude could not reply right now. Please try again.'};
  Object.assign(errors,{timeout:'This reply took too long. Your API key may still be working. Please retry the message.',network_error:'The connection was interrupted while waiting for a reply. Please retry.',response_limit:'Claude reached the response limit before finishing a readable answer. Please retry.',empty_response:'Claude returned no readable answer this time. Please retry.',invalid_response:'The reply could not be read. Please retry.',invalid_request:'This message or conversation could not be accepted. Refresh the page to start a new chat.',session_expired:'Please refresh the page, then send your message again.'});
  function setBusy(value){busy=value;log.setAttribute('aria-busy',String(value));root.querySelectorAll('[data-orbee],button[type=submit],#orbee-share-field').forEach(button=>button.disabled=value);}
  async function ask(question,topic,userEntered=false,retryReply=null){
    if(busy)return;
    log.querySelectorAll('.orbee-retry').forEach(button=>button.disabled=true);
    setBusy(true);await checkConnection();
    if(!ai){
      if(retryReply){retryReply.replaceChildren(make('p',errors.not_configured));trim();}
      else if(!userEntered)guide(question,topic,userEntered);
      else{
        ['orbee-title','orbee-answer','orbee-link'].forEach(id=>document.getElementById(id)?.removeAttribute('id'));
        appendUser(question,true);const reply=make('div');reply.className='orbee-message orbee-message-bot orbee-reply-error';
        const answer=make('p','My AI connection is offline, so I cannot give a conversational answer yet. Open Connect Claude above to finish connecting this server. The topic buttons still offer the app guide.');answer.id='orbee-answer';reply.append(answer);log.append(reply);trim();
      }
      setBusy(false);return;
    }
    if(!retryReply)appendUser(question,userEntered);
    ['orbee-title','orbee-answer','orbee-link'].forEach(id=>document.getElementById(id)?.removeAttribute('id'));
    const reply=retryReply||make('div');reply.className='orbee-message orbee-message-bot orbee-ai-reply';
    const text=make('p','Orbee is replying…');reply.replaceChildren(text);if(!retryReply)log.append(reply);trim();
    try{
      const share=document.getElementById('orbee-share-field').checked,version=contextVersion;
      const response=await fetch('/api/orbee/chat/',{method:'POST',headers:{'Content-Type':'application/json','X-CSRFToken':form.querySelector('[name=csrfmiddlewaretoken]').value},
        body:JSON.stringify({message:question,history,context_pin:contextPin,language:document.documentElement.lang||'en',include_field:share}),signal:AbortSignal.timeout(65000),cache:'no-store'});
      if(response.status===403)throw Object.assign(new Error(),{status:'session_expired',retryable:false});
      const data=await response.json();if(!response.ok||data.status!=='ok')throw Object.assign(new Error(),{status:data.status,retryable:data.retryable});
      if(version!==contextVersion)throw Object.assign(new Error(),{status:'pin_changed'});
      text.id='orbee-answer';text.dataset.noTranslate='';text.textContent=data.answer;
      const badge=make('small','Claude reply');reply.prepend(badge);
      connectionLabel.textContent='Claude connected';connectionLabel.dataset.mode='connected';
      if(topic){const link=make('a','Explore your field →');link.id='orbee-link';link.href='/workspace/'+topics[topic].path+'/';linkToPage(link);reply.append(link);}
      if(contextPin!==data.context_pin)history=[];
      contextPin=data.context_pin;history.push({role:'user',content:question},{role:'assistant',content:data.answer.slice(0,8000)});
      while(history.length>12||history.reduce((sum,message)=>sum+message.content.length,0)>18000)history.splice(0,2);
      if(data.truncated)reply.append(make('small','Reply reached its length limit. Ask Orbee to continue.'));
      greet();
    }catch(error){
      const status=error.status||(error.name==='TimeoutError'||error.name==='AbortError'?'timeout':error instanceof TypeError?'network_error':'unavailable');
      text.textContent=errors[status]||errors.unavailable;reply.classList.add('orbee-reply-error');
      const needsSetup=['not_configured','access_required','billing_required','model_unavailable','request_rejected'].includes(status);
      connectionLabel.textContent=needsSetup?'Claude connection needs attention':'Reply interrupted · you can retry';connectionLabel.dataset.mode=needsSetup?'offline':'ready';setup.hidden=!needsSetup;
      if(error.retryable!==false&&!needsSetup&&!['invalid_request','session_expired'].includes(status)){
        const retry=make('button','Retry message');retry.type='button';retry.className='orbee-retry';retry.addEventListener('click',()=>{if(!busy&&reply===log.lastElementChild)ask(question,topic,userEntered,reply);});reply.append(retry);
      }
    }
    finally{setBusy(false);trim();}
  }
  const prompts={crop:'Which crops should I consider for my field, and why?',weather:'What can the available weather records tell me about my field?',soil:'Explain the soil moisture information and what I still need to check locally.',rotation:'How can I improve my saved crop rotation?',market:'How should I compare crop prices and estimate potential income?',disease:'What should I look for when checking a crop for disease?'};
  root.querySelectorAll('[data-orbee]').forEach(button=>button.addEventListener('click',()=>ask(ai?prompts[button.dataset.orbee]:topics[button.dataset.orbee].title,button.dataset.orbee)));
  form.addEventListener('submit',event=>{
    event.preventDefault();const question=input.value.trim();if(!question||busy)return;
    const match=rules.find(([,pattern])=>pattern.test(question));ask(question,match?.[0],true);input.value='';input.focus({preventScroll:true});
  });
  document.addEventListener('terragrow-language-changed',localize);
  const resetContext=()=>{history=[];contextPin=null;++contextVersion;};
  document.getElementById('orbee-share-field').addEventListener('change',resetContext);
  document.addEventListener('field-location-selected',resetContext);document.addEventListener('field-location-saved',resetContext);
  if(!launcher)greet();
})();
