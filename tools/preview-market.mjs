// Real account creation/sign-in in an isolated SQLite database, plus layout QA.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory=mkdtempSync(join(tmpdir(),'mekongrise-market-'));
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
    '--remote-debugging-port=9234',`--user-data-dir=${directory}`,'about:blank',
  ],{windowsHide:true,stdio:'ignore'});
  let pages;
  for(let i=0;i<40;i++){
    try{pages=await(await fetch('http://127.0.0.1:9234/json')).json();break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}
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

  await navigate('/workspace/market/?guest_entry=1');
  await waitFor(`!!window.MekongRiseMarket&&!!document.querySelector('[data-market-page]')`);
  await waitFor(`document.querySelectorAll('#market-rows tr').length===8&&document.querySelector('#market-price-chart svg')&&document.getElementById('market-rate-status').textContent.includes('1 USD')`);
  const source=await(await fetch(base+'/api/market/')).json();
  const fx=await(await fetch(base+'/api/market/rates/')).json();
  assert(source.source_rows===59&&source.product_count===60&&source.crops.length===60,'Incomplete sheet import');
  const summary=()=>evaluate(`({name:document.getElementById('market-plant-name').textContent,prices:[...document.querySelectorAll('.market-price-summary strong')].map(n=>n.textContent),graph:document.querySelector('#market-price-chart desc')?.textContent,source:document.getElementById('market-row-source').href})`);
  const native=await summary();assert(native.name==='Lettuce'&&native.prices[0].includes('25,000')&&native.prices[0].includes('LAK'),'Native sheet price is wrong');
  await screenshot('market-lao-kip');
  await act(`document.getElementById('market-currency').value='USD';document.getElementById('market-currency').dispatchEvent(new Event('change'))`);
  const usd=await summary();
  assert(usd.prices[0].includes((25000/fx.rates.LAK).toFixed(2))&&usd.prices[0].includes('USD')&&usd.prices[1].includes('1.50')&&usd.graph.includes('USD'),'USD conversion did not preserve original quote bases');
  await act(`document.getElementById('market-currency').value='THB';document.getElementById('market-currency').dispatchEvent(new Event('change'))`);
  const thb=await summary();
  assert(thb.prices[0].includes((25000*fx.rates.THB/fx.rates.LAK).toFixed(2))&&thb.prices[1].includes((1.5*fx.rates.THB).toFixed(2))&&thb.graph.includes('THB'),'Cross-currency conversion is incorrect');
  const seen=new Set();
  for(let page=0;page<8;page++){
    const ids=await evaluate(`[...document.querySelectorAll('[data-market-select]')].map(n=>n.dataset.marketSelect)`);ids.forEach(id=>seen.add(id));
    if(page<7)await act(`document.getElementById('market-next').click()`);
  }
  assert(seen.size===60,'Paging dropped products: '+seen.size);
  const search=async value=>{await act(`document.getElementById('market-search').value=${JSON.stringify(value)};document.getElementById('market-search').dispatchEvent(new Event('input'))`);};
  await search('Cassava');await act(`document.querySelector('.market-learn').click()`);
  const cassava=await summary();
  assert(cassava.name==='Cassava (raw)'&&cassava.prices[1]==='Not provided in the sheet','Cassava borrowed the sweet-potato world price');
  assert(await evaluate(`document.getElementById('market-more').open&&document.querySelectorAll('.market-season-list>div').length===5&&document.querySelectorAll('.market-original-row dl>div').length===12&&document.getElementById('market-growing-days').textContent.includes('240')`),'Learn-more lost source information');
  await search('Sweet potato');const sweet=await summary();assert(sweet.name==='Sweet potato'&&sweet.prices[1].includes('THB'),'Sweet potato was not kept separate');
  await search('');await act(`document.getElementById('market-group').value='4';document.getElementById('market-group').dispatchEvent(new Event('change'))`);
  assert(await evaluate(`document.getElementById('market-page').textContent.endsWith('/ 8')`),'Category filter is incorrect');
  await act(`document.querySelector('[data-theme-toggle]').click()`);
  assert(await evaluate(`document.documentElement.dataset.theme==='dark'&&getComputedStyle(document.getElementById('market-dialog')).backgroundColor==='rgb(23, 39, 30)'`),'Dark market palette is missing');
  await act(`document.getElementById('market-group').value='';document.getElementById('market-group').dispatchEvent(new Event('change'))`);await search('Lettuce');
  await screenshot('market-dark-thai-baht');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await act(`document.querySelector('.market-learn').click()`);await new Promise(resolve=>setTimeout(resolve,450));
  const mobile=await evaluate(`({dialogOverflow:document.getElementById('market-dialog').scrollWidth>document.getElementById('market-dialog').clientWidth,bodyOverflow:document.documentElement.scrollWidth>innerWidth,chart:document.querySelector('#market-price-chart svg').getBoundingClientRect().width,sourceFacts:document.querySelectorAll('.market-season-list>div').length})`);
  assert(!mobile.dialogOverflow&&!mobile.bodyOverflow&&mobile.chart>200&&mobile.sourceFacts===5,'Mobile market layout failed: '+JSON.stringify(mobile));
  await screenshot('market-mobile');
  await call('Fetch.enable',{patterns:[{urlPattern:base+'/api/market/rates/'}]});
  await act(`document.getElementById('market-reload').click()`);
  await waitFor(`document.getElementById('market-rate-status').textContent.includes('Conversion unavailable')&&!document.getElementById('market-reload').disabled`);
  const offline=await summary();assert(offline.prices[0].includes('LAK')&&offline.prices[1].includes('USD')&&!offline.graph.includes('NaN'),'Rate failure invented a conversion or hid the original quotes');
  await call('Fetch.disable');
  await act(`document.getElementById('market-reload').click()`);
  await waitFor(`document.getElementById('market-rate-status').textContent.includes('1 USD')`);
  await act(`document.getElementById('language-toggle').click();document.querySelector('[data-language=lo]').click()`);
  assert(await evaluate(`document.getElementById('market-heading').textContent!=='Plant prices & planting guide'&&document.getElementById('market-plant-name').textContent==='Lettuce'`),'Market translation failed or altered a source crop name');
  await act(`document.getElementById('language-toggle').click();document.querySelector('[data-language=en]').click();document.querySelector('.sidebar nav a[href="/map/"]').click()`);
  await waitFor(`location.pathname==='/map/'&&document.readyState==='complete'&&!!document.querySelector('#live-map .leaflet-pane')`);
  await act(`document.querySelector('[data-dialog="location-dialog"]').click();document.getElementById('manual-latitude').value=18;document.getElementById('manual-longitude').value=102.6;document.getElementById('coordinate-form').requestSubmit()`);
  await waitFor(`!!document.getElementById('view-field-results')`);
  await act(`document.getElementById('view-field-results').click()`);
  await waitFor(`!!document.querySelector('[data-crop-market="maize"] button')`);
  await act(`document.getElementById('crop-all').open=true;document.querySelector('[data-crop-market="maize"] button').click()`);
  await waitFor(`document.getElementById('market-dialog').open&&document.getElementById('market-plant-name').textContent==='Field Corn / Maize'`);
  assert(await evaluate(`document.querySelectorAll('#market-rows tr').length===1&&document.querySelector('[data-market-select]').dataset.marketSelect==='36'`),'Crop price link selected sweet corn or the full fixed list');
  assert(errors.length===0,'Browser errors: '+errors.join(', '));
  console.log(JSON.stringify({isolatedDatabase:true,sourceRows:source.source_rows,products:seen.size,rates:{status:fx.status,dates:fx.dates},native,usd,thb,cassava,mobile,allSourceFields:true,darkMode:true,conversionFailureUsesNativeQuotes:true,maizeCropLink:true,lao:true,errors,screenshots:directory},null,2));
}finally{socket?.close();chrome?.kill();server.kill();}
