// Exercise live history in Chrome. Failure and race cases are explicitly simulated.
// No location POSTs are sent and the user's saved field is never modified.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'terragrow-weather-'));
let before;
for(let attempt=0;attempt<30;attempt++){
  try{before=(await(await fetch('http://127.0.0.1:8000/api/dashboard/')).json()).field;break;}
  catch{await new Promise(resolve=>setTimeout(resolve,200));}
}
if(!before)throw new Error('Django server did not become ready on port 8000');
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=9227',`--user-data-dir=${directory}`,'about:blank',
], { windowsHide:true, stdio:'ignore' });
let socket;
try {
  let pages;
  for(let i=0;i<40;i++){
    try{pages=await(await fetch('http://127.0.0.1:9227/json')).json();break;}
    catch{await new Promise(resolve=>setTimeout(resolve,250));}
  }
  if(!pages)throw new Error('QA browser did not start');
  socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0, historyRequests=0, failure=false;
  const pending=new Map(),errors=[];
  const call=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));});
  socket.onmessage=event=>{
    const data=JSON.parse(event.data);
    if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.text);
    if(data.method==='Network.requestWillBeSent'&&data.params.request.url.includes('/api/weather/history/'))historyRequests++;
    if(data.method==='Fetch.requestPaused'){
      if(failure)call('Fetch.fulfillRequest',{requestId:data.params.requestId,responseCode:failure==='malformed'?200:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(failure==='malformed'?'{"status":"ok"}':'{"status":"unavailable"}').toString('base64')});
      else call('Fetch.continueRequest',{requestId:data.params.requestId});
    }
    if(pending.has(data.id)){const {resolve,reject}=pending.get(data.id);pending.delete(data.id);if(data.error)reject(new Error(data.error.message));else resolve(data.result);}
  };
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  const act=expression=>evaluate('(()=>{'+expression+';return true;})()');
  const assert=(condition,reason)=>{if(!condition)throw new Error(reason);};
  const waitFor=async(expression,timeout=45000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,150));}throw new Error('Timed out: '+expression);};
  const screenshot=async name=>{const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(directory,name+'.png'),Buffer.from(image.data,'base64'));};
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:'http://127.0.0.1:8000/map/?guest_entry=1#map'});
  await waitFor(`document.readyState==='complete'&&window.L&&document.getElementById('weather-history')`);
  assert(historyRequests===0,'History loaded before the weather view was opened');
  await act(`document.dispatchEvent(new CustomEvent('field-results-ready',{detail:{tab:'weather'}}))`);
  await waitFor(`!document.getElementById('history-content').hidden&&document.getElementById('history-chart').querySelector('svg')`);
  assert(historyRequests===1,'Duplicate history requests while opening weather view');
  await waitFor(`document.getElementById('place-card').getAttribute('aria-busy')==='false'&&!!document.getElementById('place-name').textContent`);
  const recent=await evaluate(`({metrics:[...document.querySelectorAll('.history-metric strong')].map(node=>node.textContent),days:document.getElementById('history-date-slider').max,place:document.getElementById('place-name').textContent,wind:document.getElementById('weather-wind').textContent})`);
  assert(recent.days==='99'&&recent.metrics.every(value=>!value.includes('—')),'Recent live metrics missing: '+JSON.stringify(recent));
  for(const variable of ['temperature','wind','soil','rain']){
    await act(`document.querySelector('[data-history-variable=${variable}]').click()`);
    assert(await evaluate(`!!document.getElementById('history-chart').querySelector('svg')`),'Missing '+variable+' chart');
    if(variable==='temperature')assert(await evaluate(`document.getElementById('history-chart').querySelectorAll('path').length===3`),'Temperature chart lacks high/mean/low');
  }
  await act(`document.getElementById('history-date-slider').value=99;document.getElementById('history-date-slider').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert(await evaluate(`document.getElementById('history-chart-reading').textContent.includes('2026')`),'Date slider did not expose exact record');
  await screenshot('weather-100days-desktop');
  await act(`document.querySelector('.history-chart-card').scrollIntoView({block:'center'})`);
  await screenshot('weather-rainfall-chart-desktop');
  await act(`document.getElementById('results-scroll-area').scrollTop=0`);
  await act(`document.getElementById('history-daily-details').open=true`);
  await waitFor(`document.getElementById('history-days').children.length===50`);
  await act(`document.getElementById('history-more').click()`);
  assert(await evaluate(`document.getElementById('history-days').children.length===100&&document.getElementById('history-more').hidden`),'Daily table paging failed');
  await act(`document.getElementById('history-daily-details').open=false`);

  const counts={};
  for(const [period,expected] of [['1y',364],['5y',59],['10y',119]]){
    await act(`document.querySelector('[data-history-period="${period}"]').click()`);
    await waitFor(`!document.getElementById('history-content').hidden&&document.getElementById('history-date-slider').max==='${expected}'`);
    counts[period]=await evaluate(`({chartPoints:Number(document.getElementById('history-date-slider').max)+1,years:document.getElementById('history-years').children.length,period:document.getElementById('history-period').textContent})`);
  }
  assert(counts['5y'].years===5&&counts['10y'].years===10,'Annual comparison failed');
  await act(`document.querySelector('[data-history-variable=soil]').click()`);
  assert(await evaluate(`document.getElementById('history-chart-unit').textContent==='/ 1'`),'Soil wetness was relabelled as volumetric content');
  await act(`document.querySelector('[data-history-variable=rain]').click()`);
  await screenshot('weather-10years-desktop');

  await act(`const original=URL.createObjectURL;URL.createObjectURL=function(blob){window.__csv=blob;return original.call(this,blob);};HTMLAnchorElement.prototype.click=function(){if(this.download)window.__download=this.download;};document.getElementById('history-download').click()`);
  const csv=await evaluate(`(async()=>{const text=await __csv.text();return {lines:text.trim().split(/\\r?\\n/).length,header:text.split(/\\r?\\n/)[0],filename:__download};})()`);
  assert(csv.lines===3654&&csv.header.includes('GWETTOP_0–1')&&csv.header.includes('mean_wind_at_2m_m_s'),'CSV export omitted data or units: '+JSON.stringify(csv));
  await act(`document.getElementById('history-daily-details').open=true`);
  await waitFor(`document.getElementById('history-days').children.length===50`);
  assert(await evaluate(`document.getElementById('history-days').children.length<3653`),'Thousands of table rows rendered together');
  await act(`document.getElementById('history-daily-details').open=false;document.querySelector('[data-history-period="100d"]').click()`);
  await waitFor(`!document.getElementById('history-content').hidden&&document.getElementById('history-date-slider').max==='99'`);
  await act(`document.querySelector('.results-close').click();document.getElementById('language-toggle').click();document.querySelector('[data-language=lo]').click()`);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await act(`document.dispatchEvent(new CustomEvent('field-results-ready',{detail:{tab:'weather'}}))`);
  await new Promise(resolve=>setTimeout(resolve,500));
  const mobile=await evaluate(`({heading:document.getElementById('history-heading').textContent,overflow:document.getElementById('results-scroll-area').scrollWidth>document.getElementById('results-scroll-area').clientWidth,buttons:[...document.querySelectorAll('[data-history-period],[data-history-variable]')].map(node=>({text:node.textContent,height:node.getBoundingClientRect().height})),place:document.getElementById('place-name').textContent})`);
  assert(!mobile.overflow&&mobile.heading.includes('ຝົນ')&&mobile.buttons.every(button=>button.height>=44)&&Boolean(mobile.place),'Mobile or Lao regression: '+JSON.stringify(mobile));
  await screenshot('weather-lao-mobile');
  assert(mobile.buttons.every(button=>!/[A-Za-z]/.test(button.text)),'A primary weather control remained untranslated');
  await act(`document.querySelector('.history-chart-card').scrollIntoView({block:'center'})`);
  await screenshot('weather-chart-lao-mobile');
  await act(`document.getElementById('results-scroll-area').scrollTop=0`);
  await act(`document.querySelector('.results-close').click();document.getElementById('language-toggle').click();document.querySelector('[data-language=th]').click();document.dispatchEvent(new CustomEvent('field-results-ready',{detail:{tab:'weather'}}))`);
  assert(await evaluate(`document.getElementById('history-heading').textContent.includes('ฝน')`),'Thai weather translation missing');
  await act(`document.querySelector('.results-close').click();document.getElementById('language-toggle').click();document.querySelector('[data-language=en]').click();document.dispatchEvent(new CustomEvent('field-results-ready',{detail:{tab:'weather'}}))`);

  // Explicitly simulated HTTP failure: clear old results and permit a retry.
  await call('Fetch.enable',{patterns:[{urlPattern:'http://127.0.0.1:8000/api/weather/history/*'}]});failure=true;
  await act(`document.getElementById('history-refresh').click()`);
  await waitFor(`document.getElementById('history-status').textContent.includes('Could not load')`);
  assert(await evaluate(`document.getElementById('history-content').hidden&&document.getElementById('history-metrics').children.length===0`),'Failure left old results displayed');
  failure='malformed';await act(`document.getElementById('history-refresh').click()`);
  await waitFor(`!document.getElementById('history-refresh').disabled`);
  assert(await evaluate(`document.getElementById('history-content').hidden`),'Malformed source response was rendered');
  failure=false;await act(`document.getElementById('history-refresh').click()`);
  await waitFor(`!document.getElementById('history-content').hidden`);
  await act(`document.getElementById('history-refresh').click();document.dispatchEvent(new CustomEvent('field-location-selected',{detail:{latitude:15.18,longitude:106.23}}))`);
  await new Promise(resolve=>setTimeout(resolve,500));
  assert(await evaluate(`document.getElementById('history-content').hidden&&document.getElementById('history-status').textContent.includes('Save this pin')`),'A previous response repopulated data after the pin changed');
  assert(errors.length===0,'Browser errors: '+errors.join(', '));
  const after=(await(await fetch('http://127.0.0.1:8000/api/dashboard/')).json()).field;
  assert(JSON.stringify(before)===JSON.stringify(after),'User database changed during read-only QA');
  console.log(JSON.stringify({liveRecent:recent,livePeriods:counts,csv,mobile,simulatedFailureAndRetry:true,staleResponseDiscarded:true,databaseUnchanged:true,errors,screenshots:directory},null,2));
} finally { socket?.close();chrome.kill(); }
