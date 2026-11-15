// Real account creation/sign-in in an isolated SQLite database, plus layout QA.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory=mkdtempSync(join(tmpdir(),'mekongrise-orbee-ai-'));
const server=spawn('.venv/Scripts/python.exe',['-u','tools/run_auth_preview.py'],{windowsHide:true,env:{...process.env,ANTHROPIC_API_KEY:''},stdio:['ignore','pipe','pipe']});
let base='',serverLogs='';
server.stdout.on('data',chunk=>{serverLogs+=chunk;const match=serverLogs.match(/AUTH_PREVIEW_URL=(http:\/\/127\.0\.0\.1:\d+)/);if(match)base=match[1];});
server.stderr.on('data',chunk=>{serverLogs+=chunk;});
let chrome,socket;
try{
  for(let i=0;i<100;i++){
    if(base){try{if((await fetch(base+'/login/')).ok)break;}catch{}}
    if(server.exitCode!==null)throw new Error('Isolated server failed: '+serverLogs);
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!base)throw new Error('Isolated server did not start: '+serverLogs);
  chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
    '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
    '--remote-debugging-port=9237',`--user-data-dir=${directory}`,'about:blank',
  ],{windowsHide:true,stdio:'ignore'});
  let pages;
  for(let i=0;i<40;i++){
    try{pages=await(await fetch('http://127.0.0.1:9237/json')).json();break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}
  }
  if(!pages)throw new Error('QA browser did not start');
  socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map(),errors=[],sent=[];let failure=false,available=true,failureStatus='rate_limited';
  const call=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));});
  socket.onmessage=event=>{const data=JSON.parse(event.data);
    if(data.method==='Fetch.requestPaused'){
      const {requestId,request}=data.params;let body={status:available?'ready':'not_configured',provider:'Anthropic Claude',model:'SIMULATED-QA',reply_style:'conversational-v2',response_policy:'multilingual-v1'},code=200;
      if(request.method==='POST'){
        const payload=JSON.parse(request.postData);sent.push({payload,headers:Object.keys(request.headers).map(k=>k.toLowerCase())});
        body=failure?{status:failureStatus,retryable:true}:{status:'ok',answer:'SIMULATED CLAUDE QA: '+payload.message+'\nFollow-up turns: '+payload.history.length,context_pin:payload.include_field?'qa-pin':null};code=failure?(failureStatus==='rate_limited'?429:503):200;
      }
      setTimeout(()=>call('Fetch.fulfillRequest',{requestId,responseCode:code,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')}),request.method==='POST'?250:0);
    }
    if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);
    if(pending.has(data.id)){const {resolve,reject}=pending.get(data.id);pending.delete(data.id);if(data.error)reject(new Error(data.error.message));else resolve(data.result);}
  };
  const evaluate=async expression=>{const response=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));return response.result.value;};
  const act=expression=>evaluate('(()=>{'+expression+';return true;})()');
  const waitFor=async expression=>{const end=Date.now()+50000;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,150));}throw new Error('Timed out: '+expression+' at '+await evaluate(`JSON.stringify({href:location.href,ready:document.readyState,entry:sessionStorage.getItem('mekongrise-guest-entry')})`));};
  const screenshot=async name=>{const data=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(directory,name+'.png'),Buffer.from(data.data,'base64'));};
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  const navigate=async path=>{await call('Page.navigate',{url:base+path});await waitFor(`document.readyState==='complete'`);};
  await call('Page.enable');await call('Runtime.enable');
  await call('Browser.setPermission',{origin:base,permission:{name:'geolocation'},setting:'denied'});
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});




  const actual=await(await fetch(base+'/api/orbee/chat/')).json();assert(actual.status==='not_configured','QA must not use a real paid key');
  await call('Fetch.enable',{patterns:[{urlPattern:base+'/api/orbee/chat/'}]});
  await navigate('/workspace/orbee/?guest_entry=1');
  await waitFor(`document.getElementById('orbee-ai-status')?.textContent.includes('Powered by Claude')`);
  const ask=async question=>{await act(`document.getElementById('orbee-question').value=${JSON.stringify(question)};document.getElementById('orbee-chat-form').requestSubmit()`);await waitFor(`document.getElementById('orbee-messages').getAttribute('aria-busy')==='false'`);};
  await ask('Tell me a short story about a farmer');
  assert(await evaluate(`document.getElementById('orbee-answer').textContent.includes('SIMULATED CLAUDE QA')`),'Free-form question still used a topic-guide answer');
  assert(sent[0].payload.history.length===0&&sent[0].headers.includes('x-csrftoken'),'Missing CSRF or invalid initial history');
  await ask('Continue that story');assert(sent[1].payload.history.length===2&&sent[1].payload.history[0].content==='Tell me a short story about a farmer','Follow-up history was lost');
  await act(`document.getElementById('orbee-share-field').checked=false;document.getElementById('orbee-share-field').dispatchEvent(new Event('change'))`);
  await ask('Explain this without my field information');assert(sent[2].payload.include_field===false&&sent[2].payload.history.length===0,'Field sharing toggle retained private history');
  await ask('<img src=x onerror=alert(1)>');assert(await evaluate(`!document.querySelector('#orbee-messages img')&&document.getElementById('orbee-answer').textContent.includes('<img')`),'AI reply rendered unsafe HTML');
  failure=true;await ask('Another question');
  assert(await evaluate(`document.querySelector('.orbee-reply-error').textContent.includes('Too many messages')`),'Provider error was hidden behind a guided response');failure=false;
  failure=true;failureStatus='timeout';await ask('Explain rainfall patterns');
  assert(await evaluate(`document.getElementById('orbee-connection-label').dataset.mode==='ready'&&document.getElementById('orbee-setup').hidden&&!!document.querySelector('#orbee-messages>div:last-child .orbee-retry:not([disabled])')`),'Timeout incorrectly requests reconnection or lacks retry');
  const count=await evaluate(`document.querySelectorAll('.orbee-message-user').length`),failedPayload=sent.at(-1).payload;
  failure=false;await act(`document.querySelector('#orbee-messages>div:last-child .orbee-retry').click()`);
  await waitFor(`document.getElementById('orbee-messages').getAttribute('aria-busy')==='false'`);
  assert(await evaluate(`document.querySelectorAll('.orbee-message-user').length===${count}&&!document.querySelector('#orbee-messages>div:last-child').classList.contains('orbee-reply-error')`),'Retry duplicated the user message or left an error');
  assert(sent.at(-1).payload.message===failedPayload.message&&JSON.stringify(sent.at(-1).payload.history)===JSON.stringify(failedPayload.history),'Retry changed the original question/history');
  await act(`document.getElementById('language-toggle').click();document.querySelector('[data-language=lo]').click()`);
  await ask('Hello again');assert(sent.at(-1).payload.language==='lo','Selected language not forwarded');
  available=false;const before=sent.length;await ask('Explain how crops grow');
  assert(sent.length===before&&await evaluate(`document.getElementById('orbee-answer').closest('.orbee-reply-error')!==null&&document.getElementById('orbee-connection-label').dataset.mode==='offline'`),'Offline typed question was silently replaced by a canned guide');
  available=true;await ask('Can you explain now?');
  assert(sent.length===before+1&&await evaluate(`document.getElementById('orbee-connection-label').dataset.mode==='connected'`),'Connection did not recover without reloading');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await act(`document.querySelector('[data-theme-toggle]').click()`);await screenshot('orbee-ai-simulated-mobile');
  assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),'Mobile AI chat overflows');
  await act(`document.querySelector('.sidebar nav a[href="/map/"]').click()`);
  await waitFor(`location.pathname==='/map/'&&document.readyState==='complete'&&!!document.getElementById('orbee-launcher')`);
  await act(`document.getElementById('orbee-launcher').click()`);await waitFor(`document.getElementById('orbee-ai-status').textContent.includes('Claude')`);
  await ask('Hello from the map');assert(sent.at(-1).payload.history.length===0,'Chat transcript leaked between page instances');
  assert(errors.length===0,'Browser errors: '+errors.join('\n'));
  console.log(JSON.stringify({providerReplies:'Explicitly simulated; no paid Claude calls',freeForm:true,followUps:true,csrfHeader:true,fieldOptOut:true,safeText:true,providerErrorVisible:true,language:true,mobile:true,homeLauncher:true,errors,screenshots:directory},null,2));
}finally{socket?.close();chrome?.kill();server.kill();}
