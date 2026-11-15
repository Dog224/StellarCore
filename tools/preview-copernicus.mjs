// Isolated Chrome QA. Only the positive/negative processing scenarios are mocked;
// the first check reads the real, unauthenticated Copernicus catalogue. No farm
// location, crop, credentials, or other database values are changed.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'terragrow-copernicus-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9224', `--user-data-dir=${directory}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let socket;
try {
  let pages;
  for (let i=0; i<40; i++) {
    try { pages = await (await fetch('http://127.0.0.1:9224/json')).json(); break; }
    catch { await new Promise(resolve=>setTimeout(resolve,250)); }
  }
  if (!pages) throw new Error('QA browser did not start');
  socket = new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0, vegetation;
  const pending=new Map(), errors=[];
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const current=++id; pending.set(current,{resolve,reject}); socket.send(JSON.stringify({id:current,method,params}));
  });
  const realCatalogue=await (await fetch('http://127.0.0.1:8000/api/copernicus/?kind=catalogue')).json();
  socket.onmessage=event=>{
    const data=JSON.parse(event.data);
    if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.text);
    if(data.method==='Fetch.requestPaused') {
      const url=new URL(data.params.request.url);
      const isImage=url.pathname.endsWith('/image/');
      // A synthetic one-pixel PNG is only used to exercise Leaflet's loading path.
      const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2S0AAAAASUVORK5CYII=';
      const body=isImage?png:Buffer.from(JSON.stringify(url.searchParams.get('kind')==='catalogue'?realCatalogue:vegetation)).toString('base64');
      call('Fetch.fulfillRequest',{requestId:data.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:isImage?'image/png':'application/json'}],body}).catch(error=>errors.push(String(error)));
      return;
    }
    if(pending.has(data.id)) {
      const {resolve,reject}=pending.get(data.id);pending.delete(data.id);
      if(data.error)reject(new Error(data.error.message));else resolve(data.result);
    }
  };
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor=async expression=>{
    for(let i=0;i<100;i++) {if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,200));}
    throw new Error('Timed out: '+expression);
  };
  await call('Runtime.enable');await call('Page.enable');
  await call('Browser.grantPermissions',{origin:'http://127.0.0.1:8000',permissions:['geolocation']});
  await call('Emulation.setGeolocationOverride',{latitude:18.01,longitude:102.65,accuracy:20});
  await call('Emulation.setDeviceMetricsOverride',{width:1536,height:1024,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:'http://127.0.0.1:8000/map/?guest_entry=1'});
  await waitFor(`!!document.querySelector('.pin-results-button')`);
  await evaluate(`document.getElementById('view-field-results').click();document.querySelector('[data-results-tab=vegetation]').click()`);
  await waitFor(`document.getElementById('vegetation-monitor')?.getAttribute('aria-busy')==='false'`);
  const live=await evaluate(`({status:document.getElementById('vegetation-monitor').dataset.status,ndvi:document.getElementById('copernicus-ndvi').textContent,source:document.querySelector('#copernicus-catalogue a')?.href,date:document.querySelector('.copernicus-pass strong')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth,scope:document.querySelector('#vegetation-monitor>.gaez-intro').textContent})`);
  if(realCatalogue.status!=='ok'||live.status!=='not_configured'||live.ndvi!=='\u2014'||!live.source?.startsWith('https://stac.dataspace.copernicus.eu/')||!live.scope.includes('×')||live.overflow)throw new Error(JSON.stringify(live));
  await evaluate(`document.getElementById('vegetation-monitor').scrollIntoView()`);
  await new Promise(resolve=>setTimeout(resolve,400));
  const clip=await evaluate(`(()=>{const r=document.getElementById('vegetation-monitor').getBoundingClientRect();return{x:r.x,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})()`);
  const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});
  writeFileSync(join(directory,'live-catalogue.png'),Buffer.from(screenshot.data,'base64'));

  const recent=offset=>new Date(Date.now()-offset*86400000).toISOString().slice(0,10);
  const positive={...realCatalogue,status:'ok',trend:'decreased',latest:{date:recent(2),ndvi:.62,usable_percent:90},observations:[
    {date:recent(8),ndvi:.73,usable_percent:95},{date:recent(2),ndvi:.62,usable_percent:90}],
    image_url:'/api/copernicus/image/?pin='+realCatalogue.pin+'&date='+recent(2)};
  vegetation=positive;
  await call('Fetch.enable',{patterns:[{urlPattern:'*/api/copernicus/*'}]});
  await evaluate(`document.getElementById('copernicus-refresh').click()`);
  await waitFor(`document.getElementById('copernicus-ndvi').textContent==='0.62'`);
  const ready=await evaluate(`({rows:document.querySelectorAll('#copernicus-days tr').length,chart:!!document.querySelector('#copernicus-chart polyline'),meaning:document.getElementById('copernicus-trend').textContent,canShow:!document.getElementById('copernicus-show-map').hidden})`);
  if(ready.rows!==2||!ready.chart||!ready.meaning.includes('less green')||!ready.canShow)throw new Error(JSON.stringify(ready));
  await evaluate(`document.getElementById('copernicus-show-map').click()`);
  await waitFor(`!!document.querySelector('.copernicus-map-image')?.naturalWidth`);
  const overlay=await evaluate(`({legend:document.getElementById('layer-legend').textContent,tint:document.getElementById('map').classList.contains('vegetation'),image:!!document.querySelector('.copernicus-map-image')})`);
  if(!overlay.image||overlay.tint||!overlay.legend.includes('Observed vegetation')||overlay.legend.includes('Demo'))throw new Error(JSON.stringify(overlay));
  await evaluate(`document.querySelector('[data-layer=rainfall]').click();document.querySelector('[data-layer=vegetation]').click()`);
  if(!await evaluate(`document.getElementById('layer-legend').textContent.includes('Observed vegetation')`))throw new Error('Cached overlay legend did not restore');
  vegetation={status:'no_clear_observation'};
  await evaluate(`document.getElementById('copernicus-refresh').click()`);
  await waitFor(`document.getElementById('vegetation-monitor').dataset.status==='no_clear_observation'`);
  const cloudy=await evaluate(`document.getElementById('copernicus-ndvi').textContent==='\u2014'&&document.getElementById('copernicus-history').hidden&&!document.querySelector('.copernicus-map-image')`);
  if(!cloudy)throw new Error('Cloudy result retained old NDVI or imagery');
  vegetation={...positive,status:'stale',trend:'stale',latest:{...positive.latest,date:recent(40)}};
  await evaluate(`document.getElementById('copernicus-refresh').click()`);
  await waitFor(`document.getElementById('vegetation-monitor').dataset.status==='stale'`);
  if(!await evaluate(`document.getElementById('copernicus-status').textContent.includes('over 21 days old')`))throw new Error('Stale date warning missing');
  vegetation={status:'access_required'};
  await evaluate(`document.getElementById('copernicus-refresh').click()`);
  await waitFor(`document.getElementById('vegetation-monitor').dataset.status==='access_required'`);
  if(!await evaluate(`document.getElementById('copernicus-ndvi').textContent==='\u2014'`))throw new Error('Lost access retained old NDVI');
  await evaluate(`document.getElementById('language-toggle').click();document.querySelector('[data-language=lo]').click()`);
  const lao=await evaluate(`({heading:document.querySelector('#vegetation-monitor h2').textContent,status:document.getElementById('copernicus-status').textContent,scope:document.querySelector('#vegetation-monitor>.gaez-intro').textContent})`);
  if(!lao.heading.includes('ພືດ')||lao.status.includes('processing')||lao.scope.startsWith('A 200'))throw new Error(JSON.stringify(lao));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  if(await evaluate(`document.documentElement.scrollWidth>innerWidth`))throw new Error('Mobile overflow');
  await evaluate(`document.dispatchEvent(new CustomEvent('field-location-selected'))`);
  const changed=await evaluate(`document.getElementById('copernicus-ndvi').textContent==='\u2014'&&document.getElementById('copernicus-catalogue').textContent===''&&!document.querySelector('.copernicus-map-image')`);
  if(!changed||errors.length)throw new Error(JSON.stringify({changed,errors}));
  console.log(JSON.stringify({live,ready,overlay,cloudy,lao,changed,errors,screenshots:directory,processedScenarios:'Synthetic responses for browser behavior only; no authenticated live processing was claimed.'},null,2));
  await call('Browser.close');
} finally {socket?.close();chrome.kill();}
