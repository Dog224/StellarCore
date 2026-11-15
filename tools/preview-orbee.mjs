// Real account creation/sign-in in an isolated SQLite database, plus layout QA.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory=mkdtempSync(join(tmpdir(),'mekongrise-orbee-'));
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
    '--remote-debugging-port=9236',`--user-data-dir=${directory}`,'about:blank',
  ],{windowsHide:true,stdio:'ignore'});
  let pages;
  for(let i=0;i<40;i++){
    try{pages=await(await fetch('http://127.0.0.1:9236/json')).json();break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}
  }
  if(!pages)throw new Error('QA browser did not start');
  socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map(),errors=[];
  const call=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));});
  socket.onmessage=event=>{const data=JSON.parse(event.data);if(data.method==='Fetch.requestPaused')call('Fetch.fulfillRequest',{requestId:data.params.requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from('{}').toString('base64')});if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);if(pending.has(data.id)){const {resolve,reject}=pending.get(data.id);pending.delete(data.id);if(data.error)reject(new Error(data.error.message));else resolve(data.result);}};
  const evaluate=async expression=>{const response=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));return response.result.value;};
  const act=expression=>evaluate('(()=>{'+expression+';return true;})()');
  const waitFor=async expression=>{const end=Date.now()+50000;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,150));}throw new Error('Timed out: '+expression+' at '+await evaluate(`JSON.stringify({href:location.href,ready:document.readyState,entry:sessionStorage.getItem('mekongrise-guest-entry')})`));};
  const screenshot=async name=>{const data=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(directory,name+'.png'),Buffer.from(data.data,'base64'));};
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  const navigate=async path=>{await call('Page.navigate',{url:base+path});await waitFor(`document.readyState==='complete'`);};
  await call('Page.enable');await call('Runtime.enable');
  await call('Browser.setPermission',{origin:base,permission:{name:'geolocation'},setting:'denied'});
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});



  await navigate('/workspace/orbee/?guest_entry=1');
  await waitFor(`location.pathname==='/workspace/orbee/'&&document.readyState==='complete'&&!!document.querySelector('.orbee-portrait')`);
  if(process.argv.includes('--prepare-artwork')){
    const encoded=await evaluate(`(async()=>{const img=new Image();img.src='/static/website/orbee/orbee-poses.png';await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;canvas.getContext('2d').drawImage(img,0,0);return canvas.toDataURL('image/webp',0.95).split(',')[1];})()`);
    writeFileSync('website/static/website/orbee/orbee-poses.webp',Buffer.from(encoded,'base64'));
  }
  const art=await evaluate(`(async()=>{const url=JSON.parse(getComputedStyle(document.querySelector('.orbee-portrait')).backgroundImage.slice(4,-1));const im=new Image();im.src=url;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return{width:im.width,height:im.height,cornerAlpha:ctx.getImageData(0,0,1,1).data[3],pose:!!document.querySelector('.orbee-portrait')};})()`);
  assert(art.width===1536&&art.height===1024&&art.cornerAlpha===0,'Mascot artwork is missing or has an opaque background');
  assert(await evaluate(`document.querySelectorAll('#orbee-chat').length===1&&!document.getElementById('orbee-launcher')`),'Full page has duplicate chats');
  await act(`document.querySelector('[data-orbee=soil]').click()`);
  await waitFor(`!!document.getElementById('orbee-answer')`);
  assert(await evaluate(`document.getElementById('orbee-answer').textContent.includes('not soil fertility')&&document.getElementById('orbee-link').pathname==='/workspace/nasa/'`),'Soil topic failed');
  await act(`document.getElementById('orbee-question').value='What is the market price for crops?';document.getElementById('orbee-chat-form').requestSubmit()`);
  await waitFor(`document.getElementById('orbee-messages').getAttribute('aria-busy')==='false'`);
  assert(await evaluate(`document.getElementById('orbee-answer').textContent.includes('offline')&&document.getElementById('orbee-connection-label').dataset.mode==='offline'`),'Typed questions conceal missing Claude configuration');
  await act(`document.getElementById('orbee-question').value='<img src=x onerror=alert(1)> unrelated question';document.getElementById('orbee-chat-form').requestSubmit()`);
  await waitFor(`document.getElementById('orbee-messages').getAttribute('aria-busy')==='false'`);
  assert(await evaluate(`!document.querySelector('#orbee-messages img')&&[...document.querySelectorAll('#orbee-messages .orbee-message-user')].at(-1).textContent.includes('<img')`),'HTML escaping failed');
  await act(`document.getElementById('language-toggle').click();document.querySelector('[data-language=lo]').click();document.querySelector('[data-orbee=market]').click()`);
  await waitFor(`!!document.getElementById('orbee-link')`);
  assert(await evaluate(`document.documentElement.lang==='lo'&&document.getElementById('orbee-link').pathname==='/workspace/market/'&&document.getElementById('orbee-title').textContent!=='Market information'`),'Lao topic or reply translation failed');
  await act(`document.getElementById('language-toggle').click();document.querySelector('[data-language=en]').click()`);
  await screenshot('orbee-page-desktop');
  // Curated-reply links grant the next deliberate guest navigation.
  await act(`document.getElementById('orbee-link').click()`);
  await waitFor(`location.pathname==='/workspace/market/'&&document.readyState==='complete'&&!!document.getElementById('orbee-launcher')`);
  await act(`document.getElementById('orbee-launcher').focus();document.getElementById('orbee-launcher').click()`);
  assert(await evaluate(`!document.getElementById('orbee-chat').hidden&&document.getElementById('orbee-launcher').getAttribute('aria-expanded')==='true'&&document.activeElement.id==='orbee-question'`),'Widget opening/focus failed');
  await act(`document.querySelector('[data-orbee=weather]').click()`);
  await waitFor(`document.getElementById('orbee-title')?.textContent==='Weather'`);
  assert(await evaluate(`document.getElementById('orbee-title').textContent==='Weather'&&document.getElementById('orbee-link').pathname==='/workspace/nasa/'`),'Widget topics do not work');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert(await evaluate(`document.getElementById('orbee-chat').hidden&&document.activeElement.id==='orbee-launcher'`),'Escape did not close chat and restore focus');
  await act(`document.querySelector('.sidebar nav a[href="/map/"]').click()`);
  await waitFor(`location.pathname==='/map/'&&document.readyState==='complete'&&!!document.querySelector('#live-map .leaflet-pane')`);
  const map=await evaluate(`({map:!!document.getElementById('live-map'),cards:!!document.querySelector('.home-side-column'),popup:!!document.getElementById('field-results-dialog'),sprite:!!document.querySelector('.orbee-launcher-mascot')})`);
  assert(map.map&&map.cards&&map.popup&&map.sprite,'Home content was changed');
  await act(`document.getElementById('orbee-launcher').click()`);await new Promise(r=>setTimeout(r,300));await screenshot('home-with-orbee-chat');
  await act(`document.querySelector('[data-dialog="field-dialog"]').click()`);
  assert(await evaluate(`document.getElementById('orbee-chat').hidden&&getComputedStyle(document.getElementById('orbee-widget')).visibility==='hidden'`),'Orbee obstructs native results/settings dialogs');
  await act(`document.querySelector('#field-dialog [data-close]').click()`);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await act(`document.querySelector('[data-theme-toggle]').click();document.getElementById('orbee-launcher').click()`);
  await new Promise(r=>setTimeout(r,300));
  const mobile=await evaluate(`(()=>{const r=document.getElementById('orbee-chat').getBoundingClientRect();return{overflow:document.documentElement.scrollWidth>innerWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,inputVisible:!!document.getElementById('orbee-question').getClientRects().length};})()`);
  assert(!mobile.overflow&&mobile.left>=0&&mobile.right<=390&&mobile.top>=0&&mobile.bottom<=844&&mobile.inputVisible,'Mobile chat does not fit: '+JSON.stringify(mobile));
  await screenshot('orbee-widget-mobile-dark');
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert(await evaluate(`getComputedStyle(document.querySelector('.orbee-launcher-mascot')).animationName==='none'`),'Reduced-motion preference ignored');
  await act(`document.getElementById('orbee-close').click();document.querySelector('.sidebar nav a[href="/workspace/orbee/"]').click()`);
  await waitFor(`location.pathname==='/workspace/orbee/'&&document.readyState==='complete'`);
  assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),'Mobile Orbee page overflow');
  await screenshot('orbee-page-mobile-dark');
  assert(errors.length===0,'Browser errors: '+errors.join('\n'));
  console.log(JSON.stringify({art,guidedTopics:true,questionRouting:true,lao:true,safeText:true,guestReplyNavigation:true,keyboard:true,popupNotObstructed:true,home:map,mobile,reducedMotion:true,errors,screenshots:directory},null,2));
}finally{socket?.close();chrome?.kill();server.kill();}
