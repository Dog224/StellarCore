// Real account creation/sign-in in an isolated SQLite database, plus layout QA.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory=mkdtempSync(join(tmpdir(),'mekongrise-connected-static-'));
const server=spawn('.venv/Scripts/python.exe',['-u','tools/run_connected_preview.py'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
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
    '--remote-debugging-port=9238',`--user-data-dir=${directory}`,'about:blank',
  ],{windowsHide:true,stdio:'ignore'});
  let pages;
  for(let i=0;i<40;i++){
    try{pages=await(await fetch('http://127.0.0.1:9238/json')).json();break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}
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




  await navigate('/workspace/nasa/?guest_entry=1');
  await waitFor(`location.pathname==='/workspace/nasa/'&&document.readyState==='complete'&&!!window.TerraGrowI18n`);
  const assets=await evaluate(`(async()=>{const paths=[...document.querySelectorAll('script[src],link[rel=stylesheet]')].map(n=>n.src||n.href);paths.push('/static/website/icons.svg','/static/website/fonts/NotoSansLao-Variable.ttf','/static/website/orbee/orbee-poses.webp');return await Promise.all(paths.map(async url=>{const r=await fetch(url);return{url:new URL(url,location.href).pathname,status:r.status,type:r.headers.get('content-type')};}));})()`);
  assert(assets.every(asset=>asset.status===200&&!asset.type.includes('text/html')),'Asset 404/MIME failure: '+JSON.stringify(assets.filter(a=>a.status!==200||a.type.includes('text/html'))));
  assert(await evaluate(`getComputedStyle(document.querySelector('.nasa-overview-grid')).display==='grid'&&document.querySelectorAll('.nasa-overview-grid>.workspace-card').length===5`),'NASA cards did not receive their layout');
  assert(await evaluate(`!!document.querySelector('.home-brand use[href$="#sprout"]')&&getComputedStyle(document.getElementById('orbee-launcher')).position==='relative'`),'Icons/mascot layout missing');
  await act(`document.querySelector('[data-theme-toggle]').click()`);
  assert(await evaluate(`document.documentElement.dataset.theme==='dark'`),'Theme script did not execute');
  await act(`document.getElementById('language-toggle').click();document.querySelector('[data-language=lo]').click()`);
  assert(await evaluate(`document.documentElement.lang==='lo'`),'Language script did not execute');
  await screenshot('connected-server-nasa-desktop');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await new Promise(r=>setTimeout(r,200));
  assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),'Mobile layout overflows');
  await screenshot('connected-server-nasa-mobile');
  await act(`document.querySelector('.sidebar nav a[href="/map/"]').click()`);
  await waitFor(`location.pathname==='/map/'&&document.readyState==='complete'&&!!document.querySelector('#live-map .leaflet-pane')`);
  assert(await evaluate(`getComputedStyle(document.getElementById('live-map')).position==='absolute'&&!!document.getElementById('field-results-dialog')`),'Home map or results changed');
  assert(errors.length===0,'JavaScript errors: '+errors.join('\n'));
  console.log(JSON.stringify({launcher:'Real run_orbee, mocked external authentication',staticAssets:assets.length,allStatus200:true,allCorrectMime:true,nasaCards:true,theme:true,language:true,mobile:true,homeMap:true,errors,screenshots:directory},null,2));
}finally{socket?.close();chrome?.kill();server.kill();}
