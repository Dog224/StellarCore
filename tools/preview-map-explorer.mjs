// Real account creation/sign-in in an isolated SQLite database, plus layout QA.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory=mkdtempSync(join(tmpdir(),'mekongrise-map-tools-'));
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
    '--remote-debugging-port=9232',`--user-data-dir=${directory}`,'about:blank',
  ],{windowsHide:true,stdio:'ignore'});
  let pages;
  for(let i=0;i<40;i++){
    try{pages=await(await fetch('http://127.0.0.1:9232/json')).json();break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}
  }
  if(!pages)throw new Error('QA browser did not start');
  socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map(),errors=[];let currentWeather=false;
  const call=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));});
  socket.onmessage=event=>{const data=JSON.parse(event.data);if(data.method==='Fetch.requestPaused'){const body={status:currentWeather?'ok':'partial',latitude:22.3652593,longitude:94.9700784,weather:currentWeather?{status:'ok',temperature_c:29.1,humidity_percent:65,wind_kmh:9,code:3,time:new Date().toISOString().slice(0,16)+'Z'}:{status:'unavailable'},rain:currentWeather?{status:'ok',dry_days:2,rainfall_mm:9,period_start:'2026-11-08',period_end:'2026-11-14'}:{status:'unavailable'},air:{status:'ok',pm25:2.4,aqi:33,level:'Good',time:new Date().toISOString().slice(0,16)+'Z'}};call('Fetch.fulfillRequest',{requestId:data.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});}if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);if(pending.has(data.id)){const {resolve,reject}=pending.get(data.id);pending.delete(data.id);if(data.error)reject(new Error(data.error.message));else resolve(data.result);}};
  const evaluate=async expression=>{const response=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));return response.result.value;};
  const act=expression=>evaluate('(()=>{'+expression+';return true;})()');
  const waitFor=async expression=>{const end=Date.now()+50000;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,150));}throw new Error('Timed out: '+expression+' at '+await evaluate(`JSON.stringify({href:location.href,ready:document.readyState,entry:sessionStorage.getItem('mekongrise-guest-entry')})`));};
  const screenshot=async name=>{const data=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(directory,name+'.png'),Buffer.from(data.data,'base64'));};
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  const navigate=async path=>{await call('Page.navigate',{url:base+path});await waitFor(`document.readyState==='complete'`);};
  await call('Page.enable');await call('Runtime.enable');
  await call('Browser.setPermission',{origin:base,permission:{name:'geolocation'},setting:'denied'});
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});

  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    let leaflet;Object.defineProperty(window,'L',{configurable:true,get(){return leaflet;},set(value){leaflet=value;const original=value.map;value.map=function(...args){const map=original.apply(this,args);if(args[0]==='live-map')window.__main=map;if(args[0]==='mini-map')window.__mini=map;return map;};}});
    document.addEventListener('field-location-selected',event=>{window.__selection=event.detail;window.__selections=(window.__selections||0)+1;});
  `});
  await navigate('/map/?guest_entry=1');
  await waitFor(`document.readyState==='complete'&&!!window.__mini&&!document.getElementById('street-view-toggle').disabled`);
  assert(await evaluate(`!document.getElementById('map-overview').hidden&&document.querySelectorAll('.mini-country-label').length===5&&!!document.querySelector('.overview-viewport')`),'Overview did not render');
  const select=async(lat,lon)=>{
    await act(`document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelector('[data-dialog="location-dialog"]').click();document.getElementById('manual-latitude').value=${lat};document.getElementById('manual-longitude').value=${lon};document.getElementById('coordinate-form').requestSubmit()`);
    await new Promise(resolve=>setTimeout(resolve,350));
  };
  await select(18,102.6);
  await act(`document.getElementById('country-view').click()`);
  await new Promise(resolve=>setTimeout(resolve,450));
  const country=await evaluate(`({zoom:__main.getZoom(),latitude:__selection.latitude,longitude:__selection.longitude,miniWidth:document.getElementById('mini-map').getBoundingClientRect().width})`);
  assert(country.zoom<10&&country.latitude===18&&country.longitude===102.6,'Country view altered the field or failed to zoom out');
  await act(`document.getElementById('street-view-toggle').click()`);
  assert(await evaluate(`document.getElementById('street-view-dialog').open&&new URL(document.getElementById('street-view-link').href).searchParams.get('viewpoint')==='18.0000000,102.6000000'`),'Street View did not target the pin');
  await act(`document.getElementById('street-view-pick').click()`);
  const before=await evaluate('__selections');
  await act(`__main.fire('click',{latlng:L.latLng(13.7563,100.5018)})`);
  const street=await evaluate(`({url:document.getElementById('street-view-link').href,unchanged:__selections===${before}&&__selection.latitude===18,open:document.getElementById('street-view-dialog').open})`);
  assert(street.open&&street.unchanged&&new URL(street.url).searchParams.get('map_action')==='pano'&&new URL(street.url).searchParams.get('viewpoint')==='13.7563000,100.5018000','Viewing another road changed the field pin');
  await screenshot('street-view-link');
  await act(`document.querySelector('#street-view-dialog [data-close]').click()`);
  await screenshot('overview-country-desktop');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await new Promise(resolve=>setTimeout(resolve,500));
  assert(await evaluate(`document.getElementById('map-overview').hidden`),'Mini map should start collapsed on mobile');
  await act(`document.getElementById('overview-toggle').click()`);
  await new Promise(resolve=>setTimeout(resolve,250));
  const mobile=await evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,inline:document.getElementById('map-overview').parentElement.id==='map-overview-slot',visible:!document.getElementById('map-overview').hidden,labels:document.querySelectorAll('.mini-country-label').length,buttons:[...document.querySelectorAll('.map-explore-bar button')].map(b=>b.getBoundingClientRect().height)})`);
  assert(!mobile.overflow&&mobile.inline&&mobile.visible&&mobile.labels===5&&mobile.buttons.every(height=>height>=44),'Mobile map controls failed: '+JSON.stringify(mobile));
  await screenshot('overview-mobile');
  await call('Fetch.enable',{patterns:[{urlPattern:base+'/api/home/conditions/*'}]});
  await select(22.3652593,94.9700784);
  await act(`document.getElementById('view-field-results').click()`);
  await waitFor(`document.getElementById('field-results-dialog').open`);
  await act(`document.querySelector('.results-close').click()`);
  await waitFor(`document.getElementById('home-conditions').getAttribute('aria-busy')==='false'`);
  const fallback=await evaluate(`({source:document.getElementById('home-weather-source').textContent,description:document.getElementById('home-weather-description').textContent,temperature:document.getElementById('home-temperature').textContent,wind:document.getElementById('home-wind-label').textContent,period:document.getElementById('home-weather-time').textContent,dryDays:document.getElementById('home-dry-days').textContent,air:document.getElementById('home-pm25').textContent})`);
  assert(fallback.source==='NASA POWER'&&fallback.description.includes('7-day')&&fallback.wind==='Wind (2 m)'&&fallback.period.includes('2026')&&fallback.air==='2.4','Dated NASA fallback failed: '+JSON.stringify(fallback));
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await new Promise(resolve=>setTimeout(resolve,350));await screenshot('dated-nasa-fallback');
  currentWeather=true;
  await act(`document.getElementById('home-weather-retry').click()`);
  await waitFor(`document.getElementById('home-temperature').textContent.includes('29.1')`);
  assert(await evaluate(`document.getElementById('home-weather-source').textContent==='Open-Meteo'&&document.getElementById('home-wind-label').textContent==='Wind (10 m)'`),'Retry did not restore current-model source/height');
  await act(`document.getElementById('language-toggle').click();document.querySelector('[data-language=lo]').click()`);
  assert(await evaluate(`document.getElementById('street-view-toggle').textContent.trim()!=='Street View'`),'Lao map tools are not translated');
  assert(errors.length===0,'Browser errors: '+errors.join(', '));
  console.log(JSON.stringify({isolatedDatabase:true,country,street,mobile,liveNasaFallbackWithExplicitPrimaryFailureFixture:fallback,weatherRetry:true,lao:true,errors,screenshots:directory},null,2));
}finally{socket?.close();chrome?.kill();server.kill();}
