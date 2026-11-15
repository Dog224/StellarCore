// Real account creation/sign-in in an isolated SQLite database, plus layout QA.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory=mkdtempSync(join(tmpdir(),'mekongrise-alert-map-'));
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
    '--remote-debugging-port=9239',`--user-data-dir=${directory}`,'about:blank',
  ],{windowsHide:true,stdio:'ignore'});
  let pages;
  for(let i=0;i<40;i++){
    try{pages=await(await fetch('http://127.0.0.1:9239/json')).json();break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}
  }
  if(!pages)throw new Error('QA browser did not start');
  socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map(),errors=[];
  const call=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));});
  let failTiles=false;const requested=[];
  socket.onmessage=event=>{
    const data=JSON.parse(event.data);
    if(data.method==='Network.requestWillBeSent')requested.push(data.params.request.url);
    if(data.method==='Fetch.requestPaused'){
      const {requestId,request}=data.params;
      if(request.url.includes('arcgisonline.com'))call(failTiles?'Fetch.failRequest':'Fetch.continueRequest',failTiles?{requestId,errorReason:'BlockedByClient'}:{requestId});
      else {
        const conditions={status:'ok',latitude:18.016,longitude:102.649,rain:{status:'ok',dry_days:3,rainfall_mm:12,period_start:'2026-11-08',period_end:'2026-11-14'},weather:{status:'ok',temperature_c:26,time:'2026-11-15T07:00'},air:{status:'ok',pm25:2.4,time:'2026-11-15T07:00'}};
        const isConditions=request.url.includes('/api/home/conditions/');
        call('Fetch.fulfillRequest',{requestId,responseCode:isConditions?200:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(isConditions?conditions:{})).toString('base64')});
      }
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


  await call('Network.enable');
  await call('Fetch.enable',{patterns:[{urlPattern:'*/api/*'},{urlPattern:'*arcgisonline.com/*'}]});
  await navigate('/map/?guest_entry=1');
  await waitFor(`!!document.getElementById('live-map')`);
  await act(`document.querySelector('[data-dialog="location-dialog"]').click();document.getElementById('manual-latitude').value=18.016;document.getElementById('manual-longitude').value=102.649;document.getElementById('coordinate-form').requestSubmit();document.getElementById('view-field-results').click()`);
  await waitFor(`document.getElementById('field-results-dialog').open`);
  await act(`document.querySelector('.results-close').click();document.querySelector('.sidebar nav a[href="/workspace/alerts/"]').click()`);
  await waitFor(`document.body.dataset.workspace==='alerts'&&document.querySelector('#mekong-alert-map')?.dataset.imagery==='ready'&&!document.getElementById('alerts-refresh').disabled`);
  const loaded=await evaluate(`({images:document.querySelectorAll('#mekong-alert-map img.leaflet-tile-loaded').length,pin:!!document.querySelector('.mekong-pin'),reading:document.getElementById('condition-reading').textContent,attribution:document.querySelector('#mekong-alert-map .leaflet-control-attribution').textContent})`);
  assert(loaded.images>0&&loaded.pin&&loaded.reading==='3 / 7 days'&&loaded.attribution.includes('Esri'),'Live satellite map or saved field did not load');
  await screenshot('alert-map-satellite');
  failTiles=true;
  await act(`document.querySelector('#mekong-alert-map .leaflet-control-zoom-in').click()`);
  await waitFor(`document.querySelector('#mekong-alert-map').dataset.imagery==='unavailable'`);
  assert(await evaluate(`!document.querySelector('#mekong-alert-map img.leaflet-tile')&&!!document.querySelector('.mekong-pin')&&document.querySelectorAll('.mekong-country-label').length===5&&!document.querySelector('.mekong-map-retry').hidden&&document.getElementById('condition-reading').textContent==='3 / 7 days'`),'Fallback lost the pin, retained error tiles or changed environmental data');
  await act(`document.querySelector('[data-condition=flood]').click()`);
  assert(await evaluate(`document.getElementById('condition-reading').textContent==='Not assessed'`),'Fallback invented flood results');
  await act(`document.querySelector('[data-theme-toggle]').click();document.querySelector('[data-language=lo]').click()`);
  assert(await evaluate(`document.documentElement.dataset.theme==='dark'&&document.documentElement.lang==='lo'&&document.querySelector('.mekong-map-retry').textContent!=='Retry map images'`),'Dark mode or Lao fallback translation failed');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),'Mobile map fallback overflows');
  await screenshot('alert-map-fallback-mobile-dark-lao');
  failTiles=false;
  await act(`document.querySelector('.mekong-map-retry').click()`);
  await waitFor(`document.querySelector('#mekong-alert-map').dataset.imagery==='ready'`);
  assert(await evaluate(`document.querySelector('.mekong-map-retry').hidden&&document.querySelectorAll('.mekong-country-label').length===0&&!!document.querySelector('.mekong-pin')`),'Explicit retry did not restore satellite imagery');
  assert(!requested.some(url=>url.includes('tile.openstreetmap.org')),'Blocked OSM service was still requested');
  assert(errors.length===0,'Browser errors: '+errors.join('\n'));
  console.log(JSON.stringify({liveEsriImages:loaded.images,savedPin:true,fixtureWeatherIndependent:true,failedTilesRemoved:true,localBoundaries:true,retryRecovered:true,noOsmRequests:true,darkLaoMobile:true,errors,screenshots:directory},null,2));
}finally{socket?.close();chrome?.kill();server.kill();}
