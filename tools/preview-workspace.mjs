// Real account creation/sign-in in an isolated SQLite database, plus layout QA.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory=mkdtempSync(join(tmpdir(),'mekongrise-workspace-'));
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
    '--remote-debugging-port=9235',`--user-data-dir=${directory}`,'about:blank',
  ],{windowsHide:true,stdio:'ignore'});
  let pages;
  for(let i=0;i<40;i++){
    try{pages=await(await fetch('http://127.0.0.1:9235/json')).json();break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}
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


  const clickRoute=async(section)=>{
    await act(`document.querySelector('.sidebar nav a[href="/workspace/${section}/"]').click()`);
    await waitFor(`location.pathname==='/workspace/${section}/'&&document.readyState==='complete'&&document.body.dataset.workspace==='${section}'`);
  };
  const noOverflow=()=>evaluate(`document.documentElement.scrollWidth<=innerWidth`);
  await navigate('/map/?guest_entry=1');
  await waitFor(`location.pathname==='/map/'&&!!document.getElementById('live-map')`);
  const home=await evaluate(`({map:!!document.getElementById('live-map'),cards:!!document.querySelector('.home-side-column'),popup:!!document.getElementById('field-results-dialog'),links:[...document.querySelectorAll('.sidebar nav a')].map(a=>a.pathname)})`);
  assert(home.links.length===6&&home.cards&&home.map&&home.popup,'Home was changed beyond navigation');
  await screenshot('unchanged-home');
  await act(`document.querySelector('[data-dialog="location-dialog"]').click();document.getElementById('manual-latitude').value=18.016;document.getElementById('manual-longitude').value=102.649;document.getElementById('coordinate-form').requestSubmit();document.getElementById('view-field-results').click()`);
  await waitFor(`document.getElementById('field-results-dialog').open`);
  assert(await evaluate(`location.pathname==='/map/'&&document.getElementById('field-results-dialog').matches(':modal')`),'Pin results stopped being a popup');
  await act(`document.querySelector('.results-close').click()`);
  await clickRoute('crops');
  await waitFor(`document.getElementById('workspace-content').contains(document.getElementById('crop-plan'))`);
  assert(await evaluate(`!document.querySelector('dialog[open]')&&document.querySelector('.sidebar nav a.active').pathname==='/workspace/crops/'`),'Crops opened a popup');
  await waitFor(`document.getElementById('crop-recommendations').getAttribute('aria-busy')==='false'`);
  assert(await noOverflow(),'Crop page overflows');await screenshot('crops-page');
  await act(`document.getElementById('crop-all').open=true;document.querySelector('[data-crop-market="maize"] button').click()`);
  await waitFor(`location.pathname==='/workspace/market/'&&document.readyState==='complete'&&document.getElementById('market-plant-name')?.textContent==='Field Corn / Maize'`);
  assert(await evaluate(`document.querySelectorAll('#market-rows tr').length===1&&!document.querySelector('dialog[open]')`),'Crop-page price link did not navigate to the matching market product');
  await act(`document.getElementById('market-search').dispatchEvent(new Event('input'))`);
  await waitFor(`document.querySelectorAll('#market-rows tr').length===8&&document.querySelector('#market-price-chart svg')`);
  assert(await evaluate(`document.getElementById('market-dialog').tagName==='SECTION'&&!document.querySelector('dialog[open]')`),'Market is still a popup');
  await act(`document.getElementById('market-currency').value='THB';document.getElementById('market-currency').dispatchEvent(new Event('change'));document.getElementById('income-quantity').value=1000;document.getElementById('income-price').value=20;document.getElementById('income-costs').value=3000;document.getElementById('income-currency').value='THB';document.getElementById('income-form').requestSubmit()`);
  assert(await evaluate(`document.getElementById('income-result').textContent.includes('20,000 THB')&&document.getElementById('income-result').textContent.includes('17,000 THB')`),'Income arithmetic failed');
  assert(await noOverflow(),'Market page overflows');await screenshot('market-page');
  await clickRoute('nasa');
  await waitFor(`document.getElementById('nasa-history-slot').contains(document.getElementById('weather-history'))`);
  assert(await evaluate(`!document.getElementById('results-panel-weather').hidden&&!document.querySelector('dialog[open]')`),'NASA data is hidden or modal');
  await waitFor(`document.getElementById('weather-history').getAttribute('aria-busy')==='false'`);
  assert(await evaluate(`document.querySelectorAll('.nasa-overview-grid>article').length===5&&document.querySelectorAll('.nasa-mini-chart svg').length===3&&!document.getElementById('nasa-history').open`),'NASA overview or quick charts missing');
  assert(await noOverflow(),'NASA page overflows');await screenshot('nasa-page');
  await clickRoute('alerts');
  await waitFor(`!!document.querySelector('#mekong-alert-map .leaflet-pane')&&!document.getElementById('alerts-refresh').disabled`);
  const alerts=await evaluate(`({conditions:document.querySelectorAll('[data-condition]').length,readings:[...document.querySelectorAll('[data-condition-value]')].map(n=>n.textContent),pin:!!document.querySelector('.mekong-pin'),status:document.getElementById('workspace-data-status').textContent})`);
  assert(alerts.conditions===6&&alerts.pin,'Alert Mekong map/filters missing');
  await act(`document.querySelector('[data-condition=flood]').click()`);
  assert(await evaluate(`document.getElementById('condition-title').textContent==='Flood watch'&&document.getElementById('condition-reading').textContent==='Not assessed'&&document.getElementById('condition-explanation').textContent.includes('not connected')`),'Flood risk was invented');
  await act(`document.querySelector('[data-condition=air]').click()`);await screenshot('alert-mekong-page');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await new Promise(r=>setTimeout(r,200));assert(await noOverflow(),'Mobile alerts overflow');await screenshot('alerts-mobile');
  await clickRoute('orbee');await act(`document.querySelector('[data-orbee=soil]').click()`);
  assert(await evaluate(`document.getElementById('orbee-answer').textContent.includes('not soil fertility')&&document.getElementById('orbee-link').pathname==='/workspace/nasa/'`),'Orbee topic did not change');
  assert(await noOverflow(),'Mobile Orbee overflow');await screenshot('orbee-mobile');
  await act(`document.querySelector('[data-theme-toggle]').click()`);
  assert(await evaluate(`document.documentElement.dataset.theme==='dark'`),'Dark mode missing');
  await clickRoute('market');await waitFor(`document.querySelectorAll('#market-rows tr').length===8`);
  assert(await noOverflow(),'Mobile market overflow');await screenshot('market-mobile-dark');
  await act(`document.querySelector('.sidebar nav a.active').click()`);
  assert(await evaluate(`location.pathname==='/workspace/market/'`),'Clicking the current page returned guest to login');
  await call('Page.reload');await waitFor(`location.pathname==='/login/'&&document.readyState==='complete'`);
  // Signed-in users keep their workspace through refresh and browser Back.
  await navigate('/signup/');const password='Farm!'+randomBytes(15).toString('hex');
  await waitFor(`!!document.getElementById('id_email')`);
  await act(`document.getElementById('id_email').value='workspace-profile@example.test';document.getElementById('id_password1').value=${JSON.stringify(password)};document.getElementById('id_password2').value=${JSON.stringify(password)};document.getElementById('auth-form').requestSubmit()`);
  await waitFor(`location.pathname==='/map/'&&!!document.querySelector('.profile-button')`);await clickRoute('alerts');
  await call('Page.reload');await waitFor(`location.pathname==='/workspace/alerts/'&&document.readyState==='complete'&&!!document.querySelector('.profile-button')`);
  assert(errors.length===0,'Browser errors: '+errors.join('\n'));
  console.log(JSON.stringify({home,pinResultsStayModal:true,fiveSeparatePages:true,guestNavigation:true,guestRefreshGoesToLogin:true,memberRefreshStays:true,incomeArithmetic:true,alertMekong:alerts,mobileNoOverflow:true,theme:true,errors,screenshots:directory},null,2));
}finally{socket?.close();chrome?.kill();server.kill();}
