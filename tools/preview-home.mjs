// Sketch-v2 home QA. UI fixtures are explicitly simulated; live provider results are checked separately.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory=mkdtempSync(join(tmpdir(),'mekongrise-home-'));
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
    '--remote-debugging-port=9231',`--user-data-dir=${directory}`,'about:blank',
  ],{windowsHide:true,stdio:'ignore'});
  let pages;
  for(let i=0;i<40;i++){
    try{pages=await(await fetch('http://127.0.0.1:9231/json')).json();break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}
  }
  if(!pages)throw new Error('QA browser did not start');
  socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map(),errors=[];let fixture=null;
  const call=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));});
  socket.onmessage=event=>{const data=JSON.parse(event.data);if(data.method==='Fetch.requestPaused'){if(fixture)call('Fetch.fulfillRequest',{requestId:data.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(fixture)).toString('base64')});else call('Fetch.continueRequest',{requestId:data.params.requestId});}if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.text);if(pending.has(data.id)){const {resolve,reject}=pending.get(data.id);pending.delete(data.id);if(data.error)reject(new Error(data.error.message));else resolve(data.result);}};
  const evaluate=async expression=>{const response=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));return response.result.value;};
  const act=expression=>evaluate('(()=>{'+expression+';return true;})()');
  const waitFor=async expression=>{const end=Date.now()+20000;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,150));}throw new Error('Timed out: '+expression);};
  const screenshot=async name=>{const data=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(directory,name+'.png'),Buffer.from(data.data,'base64'));};
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  const navigate=async path=>{await call('Page.navigate',{url:base+path});await waitFor(`document.readyState==='complete'`);};
  await call('Page.enable');await call('Runtime.enable');
  await call('Browser.setPermission',{origin:base,permission:{name:'geolocation'},setting:'denied'});
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});

  await navigate('/map/?guest_entry=1');
  await waitFor(`!!document.getElementById('live-map')&&!!document.querySelector('.home-topbar')`);
  const layout=await evaluate(`(()=>{const language=document.getElementById('language-toggle').getBoundingClientRect(),account=document.querySelector('.account-button').getBoundingClientRect(),map=document.getElementById('map').getBoundingClientRect(),cards=document.querySelector('.home-side-column').getBoundingClientRect(),brand=document.querySelector('.brand').getBoundingClientRect();return{adjacent:account.left>=language.right&&Math.abs(account.top-language.top)<5,brandAbove:brand.bottom<map.top,cardsRight:cards.left>map.right,navItems:document.querySelectorAll('.sidebar nav a,.sidebar nav button').length,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
  assert(layout.adjacent&&layout.brandAbove&&layout.cardsRight&&layout.navItems===6&&!layout.overflow,'Desktop layout mismatch: '+JSON.stringify(layout));
  assert(await evaluate(`document.getElementById('home-temperature').textContent==='\u2014'`),'New farm has invented weather');
  await act(`document.querySelector('[data-dialog="location-dialog"]').click();document.getElementById('manual-latitude').value=13.15081;document.getElementById('manual-longitude').value=108.43705;document.getElementById('coordinate-form').requestSubmit();document.getElementById('view-field-results').click()`);
  await waitFor(`document.getElementById('field-results-dialog').open`);
  await act(`document.querySelector('.results-close').click()`);
  await waitFor(`document.getElementById('home-conditions').getAttribute('aria-busy')==='false'`);
  const live=await evaluate(`(async()=>{const data=await(await fetch('/api/home/conditions/')).json();return{status:data.status,latitude:data.latitude,longitude:data.longitude,airStatus:data.air?.status,weatherStatus:data.weather?.status,temperature:document.getElementById('home-temperature').textContent};})()`);
  assert(live.latitude===13.15081&&live.longitude===108.43705,'Live cards used another pin');
  // Explicit source fixtures verify all populated UI states, including missing live weather.
  const timestamp=new Date().toISOString().slice(0,16)+'Z';
  fixture={status:'ok',latitude:13.15081,longitude:108.43705,weather:{status:'ok',temperature_c:29.3,humidity_percent:78,wind_kmh:12.2,code:3,time:timestamp},rain:{status:'ok',dry_days:4,rainfall_mm:23.4,period_start:'2026-11-08',period_end:'2026-11-14'},air:{status:'ok',pm25:18.2,aqi:67,level:'Moderate',time:timestamp}};
  await call('Fetch.enable',{patterns:[{urlPattern:base+'/api/home/conditions/'}]});
  await act(`document.dispatchEvent(new CustomEvent('field-location-saved',{detail:{latitude:13.15081,longitude:108.43705}}))`);
  await waitFor(`document.getElementById('home-temperature').textContent.includes('29.3')`);
  assert(await evaluate(`document.getElementById('home-dry-days').textContent==='4/7'&&document.getElementById('home-air-level').textContent==='Moderate'`),'Home metrics are not populated');
  await screenshot('home-desktop-simulated-cards');
  await act(`document.dispatchEvent(new CustomEvent('field-results-request',{detail:{tab:'crops'}}))`);
  await waitFor(`document.getElementById('field-results-dialog').open&&!document.getElementById('results-panel-crops').hidden`);
  assert(await evaluate(`document.getElementById('results-panel-crops').contains(document.getElementById('crop-plan'))`),'Crop rotation is outside the Crop screen');
  await act(`document.querySelector('.crop-rotation-link').click()`);
  await waitFor(`document.getElementById('results-scroll-area').scrollTop>50`);
  await act(`document.querySelector('.results-close').click();document.querySelector('[data-dialog="alerts-dialog"]').click()`);
  assert(await evaluate(`document.getElementById('alerts-dialog').open&&document.getElementById('alerts-air').textContent.includes('18.2')&&document.getElementById('alerts-rain').textContent.includes('23.4')`),'Alert details did not open with home data');
  await act(`document.querySelector('[data-home-results="weather"]').click()`);
  await waitFor(`document.getElementById('field-results-dialog').open&&!document.getElementById('results-panel-weather').hidden`);
  await act(`document.querySelector('.results-close').click()`);
  // Separate sidebar pages are exercised by preview-workspace.mjs.
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await act(`document.getElementById('language-toggle').click();document.querySelector('[data-language=lo]').click()`);
  await new Promise(resolve=>setTimeout(resolve,350));
  const mobile=await evaluate(`(()=>{const region=document.getElementById('show-region').getBoundingClientRect(),coordinates=document.querySelector('[data-dialog="location-dialog"]').getBoundingClientRect(),language=document.getElementById('language-toggle').getBoundingClientRect(),account=document.querySelector('.account-button').getBoundingClientRect();return{overflow:document.documentElement.scrollWidth>innerWidth,buttonsOverlap:!(region.right<=coordinates.left||region.left>=coordinates.right||region.bottom<=coordinates.top||region.top>=coordinates.bottom),accountAdjacent:account.left>=language.right&&Math.abs(account.top-language.top)<5,heading:document.querySelector('h1').textContent,height:document.documentElement.scrollHeight};})()`);
  assert(!mobile.overflow&&!mobile.buttonsOverlap&&mobile.accountAdjacent,'Mobile controls overlap: '+JSON.stringify(mobile));
  await screenshot('home-lao-mobile-simulated-cards');
  await act(`document.getElementById('language-toggle').click();document.querySelector('[data-language=th]').click()`);
  assert(await evaluate(`document.querySelector('.home-sidebar nav a').textContent.includes('\u0e2b\u0e19\u0e49\u0e32\u0e2b\u0e25\u0e31\u0e01')`),'Thai navigation missing');
  await act(`document.dispatchEvent(new CustomEvent('field-location-selected',{detail:{latitude:21.0285,longitude:105.8542}}))`);
  assert(await evaluate(`document.getElementById('home-temperature').textContent==='\u2014'&&document.getElementById('home-pm25').textContent==='\u2014'`),'Old home readings survived a pin change');
  await call('Fetch.enable',{patterns:[{urlPattern:base+'/api/home/conditions/'},{urlPattern:base+'/api/weather/'}]});
  fixture={status:'unavailable',latitude:13.15081,longitude:108.43705,weather:{status:'unavailable'},air:{status:'unavailable'},rain:{status:'unavailable'}};
  await act(`document.dispatchEvent(new CustomEvent('field-location-saved',{detail:{latitude:13.15081,longitude:108.43705}}))`);
  await waitFor(`document.getElementById('home-conditions').getAttribute('aria-busy')==='false'`);
  assert(await evaluate(`document.getElementById('home-temperature').textContent==='\u2014'&&document.getElementById('home-pm25').textContent==='\u2014'`),'Unavailable source displayed sample values');
  await call('Fetch.disable');
  await navigate('/signup/');
  const password='Farm!'+randomBytes(15).toString('hex');
  await act(`document.getElementById('id_email').value='home-profile@example.test';document.getElementById('id_password1').value=${JSON.stringify(password)};document.getElementById('id_password2').value=${JSON.stringify(password)};document.getElementById('auth-form').requestSubmit()`);
  await waitFor(`location.pathname==='/map/'&&!!document.querySelector('.profile-button')`);
  assert(await evaluate(`(()=>{const l=document.getElementById('language-toggle').getBoundingClientRect(),p=document.querySelector('.profile-button').getBoundingClientRect();return p.left>=l.right&&Math.abs(p.top-l.top)<5&&!document.querySelector('.account-button');})()`),'Signed-in profile is not beside language');
  await act(`document.querySelector('.profile-button').click()`);
  assert(await evaluate(`document.getElementById('profile-dialog').open`),'Header profile stopped working');
  assert(errors.length===0,'Browser errors: '+errors.join(', '));
  console.log(JSON.stringify({isolatedDatabase:true,layout,live,explicitSimulatedCards:true,cropAndRotation:true,alerts:true,workspaceNavigationTest:"preview-workspace.mjs",mobile,profileBesideLanguage:true,staleReadingsCleared:true,missingSourceValuesStayBlank:true,errors,screenshots:directory},null,2));
}finally{socket?.close();chrome?.kill();server.kill();}
