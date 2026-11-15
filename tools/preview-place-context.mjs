// Pin-specific live place/photo QA in an isolated SQLite database. No farmer data is changed.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory=mkdtempSync(join(tmpdir(),'mekongrise-places-'));
const server=spawn('.venv/Scripts/python.exe',['-u','tools/run_auth_preview.py'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
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
    '--remote-debugging-port=9230',`--user-data-dir=${directory}`,'about:blank',
  ],{windowsHide:true,stdio:'ignore'});
  let pages;
  for(let i=0;i<40;i++){
    try{pages=await(await fetch('http://127.0.0.1:9230/json')).json();break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}
  }
  if(!pages)throw new Error('QA browser did not start');
  socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map(),errors=[],imageNetwork=[];
  const call=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));});
  socket.onmessage=event=>{const data=JSON.parse(event.data);if(data.method==='Network.responseReceived'&&data.params.response.url.includes('wikimedia.org'))imageNetwork.push({response:data.params.response.status,url:data.params.response.url});if(data.method==='Network.loadingFailed')imageNetwork.push({failed:data.params.errorText,type:data.params.type});if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.text);if(pending.has(data.id)){const {resolve,reject}=pending.get(data.id);pending.delete(data.id);if(data.error)reject(new Error(data.error.message));else resolve(data.result);}};
  const evaluate=async expression=>{const response=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));return response.result.value;};
  const act=expression=>evaluate('(()=>{'+expression+';return true;})()');
  const waitFor=async expression=>{const end=Date.now()+20000;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,150));}throw new Error('Timed out: '+expression);};
  const screenshot=async name=>{const data=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(directory,name+'.png'),Buffer.from(data.data,'base64'));};
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  const navigate=async path=>{await call('Page.navigate',{url:base+path});await waitFor(`document.readyState==='complete'`);};
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
  await call('Browser.setPermission',{origin:base,permission:{name:'geolocation'},setting:'denied'});
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});

  await navigate('/map/?guest_entry=1');
  const select = async (latitude,longitude) => {
    await act(`document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelector('[data-dialog="location-dialog"]').click();document.getElementById('manual-latitude').value=${latitude};document.getElementById('manual-longitude').value=${longitude};document.getElementById('coordinate-form').requestSubmit()`);
    assert(await evaluate(`document.getElementById('place-photo-wrap').hidden&&!document.getElementById('place-photo').getAttribute('src')`),'Old photo survived a pin selection');
    await act(`document.getElementById('view-field-results').click()`);
    await waitFor(`document.getElementById('field-results-dialog').open`);
    await act(`document.getElementById('results-tab-weather').click()`);
  };
  const ready = () => waitFor(`document.getElementById('place-card').getAttribute('aria-busy')==='false'&&!!document.getElementById('place-name').textContent`);
  const summary = () => evaluate(`({name:document.getElementById('place-name').textContent,coordinates:document.getElementById('place-coordinates').textContent,photo:!document.getElementById('place-photo-wrap').hidden,photoWidth:document.getElementById('place-photo').naturalWidth,credit:document.getElementById('place-photo-credit').textContent,overflow:document.getElementById('results-scroll-area').scrollWidth>document.getElementById('results-scroll-area').clientWidth})`);
  await select(13.15081,108.43705); await ready();
  const vietnam = await summary();
  assert(vietnam.name.includes('Vietnam')&&vietnam.name.includes('Ea Hiao')&&!vietnam.photo&&!vietnam.overflow,'Vietnam fallback did not match the pin: '+JSON.stringify(vietnam));
  await screenshot('vietnam-area-name');
  await select(21.0285,105.8542); await ready();
  const hanoi=await summary();
  assert(hanoi.name.includes('Vietnam')&&hanoi.photo&&hanoi.photoWidth>0&&hanoi.credit.includes('CC BY')&&!hanoi.credit.includes('Basile Morin'),'Hanoi image/credits failed: '+JSON.stringify({hanoi,imageNetwork}));
  await screenshot('hanoi-nearby-photo');
  const motion=await evaluate(`(()=>{const button=document.getElementById('results-tab-weather');button.click();return{popup:getComputedStyle(document.getElementById('field-results-dialog')).animationName,buttonAnimations:button.getAnimations().length};})()`);
  assert(motion.popup.includes('mekong-popup-in')&&motion.buttonAnimations>0,'Popup/button animation is missing');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await new Promise(resolve=>setTimeout(resolve,400));
  const mobile=await summary();assert(!mobile.overflow,'Mobile area card overflows');
  await screenshot('place-mobile');
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await new Promise(resolve=>setTimeout(resolve,50));
  const reduced=await evaluate(`(()=>{const button=document.getElementById('results-tab-weather');button.click();return{popup:getComputedStyle(document.getElementById('field-results-dialog')).animationName,buttonAnimations:button.getAnimations().length};})()`);
  assert(reduced.popup==='none'&&reduced.buttonAnimations===0,'Reduced-motion preference was ignored');
  await select(17.9757,102.6331); await ready();
  const vientiane=await summary();assert(vientiane.name.includes('Laos')&&!vientiane.name.includes('Vietnam'),'Laos context did not change with the pin');
  // Explicit simulated late response: production source data above remains live.
  const old=await evaluate(`(async()=>await(await fetch('/api/place/')).json())()`);
  await act(`window.originalPlaceFetch=window.fetch;let delayed=false;window.fetch=(...args)=>{if(String(args[0])==='/api/place/'&&!delayed){delayed=true;return new Promise(resolve=>setTimeout(()=>resolve(new Response(${JSON.stringify(JSON.stringify(old))},{status:200,headers:{'Content-Type':'application/json'}})),900));}return window.originalPlaceFetch(...args);}`);
  await select(21.0285,105.8542);
  await select(13.15081,108.43705); await ready();
  await new Promise(resolve=>setTimeout(resolve,1100));
  const afterRace=await summary();
  assert(afterRace.name.includes('Vietnam')&&!afterRace.photo,'Late previous-pin response replaced the current area');
  await act('window.fetch=window.originalPlaceFetch');
  await act(`document.querySelector('.results-close').click();document.getElementById('language-toggle').click();document.querySelector('[data-language=lo]').click();document.getElementById('view-field-results').click()`);
  await waitFor(`document.getElementById('field-results-dialog').open`);
  await act(`document.getElementById('results-tab-weather').click()`);await ready();
  assert(await evaluate(`document.querySelector('.place-kicker span').textContent!=='Selected area'&&document.getElementById('place-name').textContent.includes('Vietnam')`),'Place translation changed the source name or failed');
  assert(errors.length===0,'Browser errors: '+errors.join(', '));
  console.log(JSON.stringify({isolatedDatabase:true,vietnam,hanoi,vientiane,mobile,motion,reduced,staleResponseIgnored:true,lao:true,errors,screenshots:directory},null,2));
}finally{socket?.close();chrome?.kill();server.kill();}
