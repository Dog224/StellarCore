// Read-only browser QA for the real crop photographs and compact card layout.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let before;
for(let i=0;i<30;i++){
  try{before=(await(await fetch('http://127.0.0.1:8000/api/dashboard/')).json()).field;break;}
  catch{await new Promise(resolve=>setTimeout(resolve,200));}
}
if(!before)throw new Error('Django server is not ready');
const directory=mkdtempSync(join(tmpdir(),'terragrow-crop-photos-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=9228',`--user-data-dir=${directory}`,'about:blank',
],{windowsHide:true,stdio:'ignore'});
let socket;
try{
  let pages;
  for(let i=0;i<40;i++){
    try{pages=await(await fetch('http://127.0.0.1:9228/json')).json();break;}
    catch{await new Promise(resolve=>setTimeout(resolve,250));}
  }
  if(!pages)throw new Error('QA browser did not start');
  socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map(),errors=[];
  const call=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));});
  socket.onmessage=event=>{const data=JSON.parse(event.data);if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.text);if(pending.has(data.id)){const{resolve,reject}=pending.get(data.id);pending.delete(data.id);if(data.error)reject(new Error(data.error.message));else resolve(data.result);}};
  const evaluate=async expression=>{const data=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(data.exceptionDetails)throw new Error(JSON.stringify(data.exceptionDetails));return data.result.value;};
  const act=expression=>evaluate('(()=>{'+expression+';return true;})()');
  const waitFor=async expression=>{const until=Date.now()+45000;while(Date.now()<until){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,200));}throw new Error('Timed out: '+expression);};
  const assert=(condition,reason)=>{if(!condition)throw new Error(reason);};
  const screenshot=async name=>{const data=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(directory,name+'.png'),Buffer.from(data.data,'base64'));};
  await call('Page.enable');await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:'http://127.0.0.1:8000/map/?guest_entry=1#gaez-explorer'});
  await waitFor(`document.getElementById('field-results-dialog')?.open&&document.querySelectorAll('.ranked-crop').length===13`);
  await waitFor(`[...document.querySelectorAll('#crop-top .crop-photo img')].every(image=>image.complete&&image.naturalWidth>=400)`);
  const data=await evaluate(`(async()=>{const report=await(await fetch('/api/crops/recommendations/')).json();return report.crops.map(crop=>({id:crop.id,score:crop.score,src:crop.image_url,kind:crop.image_kind,credit:crop.image_credit}));})()`);
  assert(data.length===13&&data.every(crop=>crop.src.endsWith('.jpg')&&crop.credit?.source_url.startsWith('https://commons.wikimedia.org/')&&crop.credit?.license),'Missing photographs or source credits');
  await screenshot('crops-desktop');
  await act(`document.querySelector('#crop-top .ranked-crop').scrollIntoView({block:'start'})`);
  await screenshot('crop-cards-desktop');
  const bodyStyle=await evaluate(`({background:getComputedStyle(document.querySelector('.ranked-crop')).backgroundColor,topBorder:getComputedStyle(document.querySelector('.ranked-crop')).borderTopWidth,imageHeight:document.querySelector('#crop-top .crop-photo img').getBoundingClientRect().height})`);
  assert(bodyStyle.topBorder==='1px'&&bodyStyle.imageHeight>=185,'Photo layout or quiet card styles not applied');
  await act(`document.getElementById('crop-all').open=true;document.querySelectorAll('.crop-photo img').forEach(image=>image.loading='eager')`);
  await waitFor(`[...document.querySelectorAll('.crop-photo img')].every(image=>image.complete&&image.naturalWidth>=400)`);
  assert(await evaluate(`document.querySelectorAll('.crop-photo img').length===13&&document.querySelectorAll('.crop-photo figcaption a').length===26`),'All-crop images or visible credits missing');
  await act(`document.querySelector('#crop-top .crop-details').open=true`);
  assert(await evaluate(`document.querySelector('#crop-top .crop-details').textContent.includes('Reference crop photograph')&&!document.querySelector('#crop-top .crop-details').textContent.includes('Crop illustration')`),'Old illustration description remains on photo cards');
  await act(`document.querySelector('#crop-top .crop-details').open=false;document.getElementById('crop-all').open=false;document.querySelector('.results-close').click();document.getElementById('language-toggle').click();document.querySelector('[data-language=lo]').click()`);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await act(`document.dispatchEvent(new CustomEvent('field-results-ready',{detail:{tab:'crops'}}))`);
  await waitFor(`document.querySelector('#crop-top .crop-photo img')?.complete`);
  await act(`document.querySelector('#crop-top .ranked-crop').scrollIntoView({block:'start'})`);
  const mobile=await evaluate(`({overflow:document.getElementById('results-scroll-area').scrollWidth>document.getElementById('results-scroll-area').clientWidth,credit:document.querySelector('#crop-top figcaption').textContent,title:document.querySelector('#crop-top h3').textContent,photo:document.querySelector('#crop-top .crop-photo img').getBoundingClientRect().height})`);
  assert(!mobile.overflow&&mobile.photo>=190&&mobile.credit.includes('ຮູບຖ່າຍ'),'Mobile layout or Lao captions failed: '+JSON.stringify(mobile));
  await screenshot('crop-card-lao-mobile');
  // A broken photo gives an honest text fallback instead of a fake observation.
  await act(`document.querySelector('#crop-top .crop-photo img').dispatchEvent(new Event('error'))`);
  assert(await evaluate(`document.querySelector('#crop-top .crop-photo img').hidden&&!!document.querySelector('.crop-photo-unavailable')`),'Broken-photo fallback failed');
  assert(errors.length===0,'Browser errors: '+errors.join(', '));
  const after=(await(await fetch('http://127.0.0.1:8000/api/dashboard/')).json()).field;
  assert(JSON.stringify(before)===JSON.stringify(after),'Read-only QA changed saved field');
  console.log(JSON.stringify({photographs:data.length,allImagesLoaded:true,visibleAuthorAndLicenseCredits:true,bodyStyle,mobile,brokenPhotoFallback:true,databaseUnchanged:true,errors,screenshots:directory},null,2));
}finally{socket?.close();chrome.kill();}
