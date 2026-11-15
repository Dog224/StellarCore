// Browser checks for the compact map/popup flow. Location POSTs are intercepted
// to test save failures and retries without changing the user's database. Data
// reads use the actual saved location; the successful test POST uses that same pin.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory=mkdtempSync(join(tmpdir(),'terragrow-results-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=9225',`--user-data-dir=${directory}`,'about:blank',
],{windowsHide:true,stdio:'ignore'});
let socket;
try {
  let pages;
  for(let i=0;i<40;i++){
    try{pages=await(await fetch('http://127.0.0.1:9225/json')).json();break;}
    catch{await new Promise(resolve=>setTimeout(resolve,250));}
  }
  if(!pages)throw new Error('QA browser did not start');
  socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0,saveMode='failure',sourceRequests=0;
  const pending=new Map(),errors=[],posts=[];
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));
  });
  socket.onmessage=event=>{
    const data=JSON.parse(event.data);
    if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);
    if(data.method==='Network.requestWillBeSent'&&/\/api\/(weather|gaez|copernicus|crops)\//.test(data.params.request.url))sourceRequests++;
    if(data.method==='Fetch.requestPaused'){
      const req=data.params.request;
      if(req.method!=='POST'){call('Fetch.continueRequest',{requestId:data.params.requestId});return;}
      const params=new URLSearchParams(req.postData);posts.push(Object.fromEntries(params));
      const body=saveMode==='failure'?{errors:{latitude:['Test save failure']}}:
        {latitude:Number(params.get('latitude')),longitude:Number(params.get('longitude'))};
      call('Fetch.fulfillRequest',{requestId:data.params.requestId,responseCode:saveMode==='failure'?400:200,
        responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});return;
    }
    if(pending.has(data.id)){
      const {resolve,reject}=pending.get(data.id);pending.delete(data.id);
      if(data.error)reject(new Error(data.error.message));else resolve(data.result);
    }
  };
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor=async(expression,timeout=15000)=>{
    const end=Date.now()+timeout;
    while(Date.now()<end){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,200));}
    throw new Error('Timed out: '+expression);
  };
  const screenshot=async name=>{
    const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    writeFileSync(join(directory,name+'.png'),Buffer.from(image.data,'base64'));
  };
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
  await call('Fetch.enable',{patterns:[{urlPattern:'http://127.0.0.1:8000/'}]});
  await call('Browser.grantPermissions',{origin:'http://127.0.0.1:8000',permissions:['geolocation']});
  const dashboard=await(await fetch('http://127.0.0.1:8000/api/dashboard/')).json();
  await call('Emulation.setGeolocationOverride',{latitude:dashboard.field.latitude,longitude:dashboard.field.longitude,accuracy:20});
  await call('Emulation.setDeviceMetricsOverride',{width:1536,height:1024,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:'http://127.0.0.1:8000/map/?guest_entry=1'});
  await waitFor(`!!document.querySelector('.pin-results-button')&&!document.getElementById('view-field-results').disabled`);
  await new Promise(resolve=>setTimeout(resolve,800));
  await waitFor(`document.querySelectorAll('.leaflet-tile').length>0&&[...document.querySelectorAll('.leaflet-tile')].filter(i=>i.complete&&i.naturalWidth>0).length>3`);
  await new Promise(resolve=>setTimeout(resolve,500));
  const main=await evaluate(`({height:document.documentElement.scrollHeight,viewport:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,dialogOpen:document.getElementById('field-results-dialog').open,pinButton:(()=>{const r=document.querySelector('.pin-results-button').getBoundingClientRect();return{width:r.width,height:r.height,x:r.x,right:r.right};})(),mainButton:(()=>{const b=document.getElementById('view-field-results'),r=b.getBoundingClientRect();return{font:getComputedStyle(b).fontSize,height:r.height};})()})`);
  if(main.overflow||main.dialogOpen||main.height>main.viewport+100||main.pinButton.height<64||sourceRequests!==0)throw new Error(JSON.stringify({main,sourceRequests}));
  await evaluate('document.fonts.ready');
  const font=await evaluate(`({family:getComputedStyle(document.body).fontFamily,loaded:document.fonts.check('18px \"Noto Sans Lao\"','???')})`);
  if(!font.loaded||!font.family.includes('Noto Sans Lao'))throw new Error(JSON.stringify(font));
  await screenshot('map-desktop');
  await evaluate(`document.querySelector('.pin-results-button').click()`);
  await waitFor(`document.getElementById('field-results-dialog').open`);
  await waitFor(`document.querySelectorAll('#crop-top article').length===3`);
  const popup=await evaluate(`({tabs:document.querySelectorAll('[role=tab]').length,active:document.querySelector('[role=tab][aria-selected=true]').dataset.resultsTab,visible:[...document.querySelectorAll('[role=tabpanel]')].filter(p=>!p.hidden).length,heading:document.getElementById('field-results-title').textContent,backgroundCollapsed:[...document.querySelectorAll('#gaez-explorer>.results-extra')].every(d=>!d.open),backHeight:document.querySelector('.results-close').getBoundingClientRect().height,focused:document.activeElement.closest('#field-results-dialog')!==null})`);
  if(popup.tabs!==4||popup.active!=='crops'||popup.visible!==1||!popup.backgroundCollapsed||popup.backHeight<48||!popup.focused)throw new Error(JSON.stringify(popup));
  await waitFor(`document.getElementById('crop-recommendations').getAttribute('aria-busy')==='false'`,100000);
  const cropResults=await evaluate(`[...document.querySelectorAll('#crop-top article')].map(c=>({name:c.querySelector('h3>span').textContent,rating:c.querySelector('.crop-level').textContent,status:c.dataset.level,score:Number(c.dataset.score)}))`);
  if(cropResults.some(c=>!c.status||c.rating==='Checking...'||!c.rating))throw new Error(JSON.stringify(cropResults));
  await screenshot('results-desktop');
  await evaluate(`document.querySelector('[data-results-tab=weather]').click()`);
  if(!await evaluate(`!document.getElementById('results-panel-weather').hidden&&document.getElementById('results-panel-crops').hidden`))throw new Error('Weather tab failed');
  await evaluate(`document.querySelector('[data-results-tab=vegetation]').focus()`);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  if(!await evaluate(`document.querySelector('[data-results-tab=plan]').getAttribute('aria-selected')==='true'&&document.activeElement.dataset.resultsTab==='plan'`))throw new Error('Keyboard tab navigation failed');
  await evaluate(`document.querySelector('[data-results-tab=crops]').click()`);
  for(let i=0;i<18;i++){
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    if(!await evaluate(`document.activeElement.closest('#field-results-dialog')!==null`))throw new Error('Focus escaped popup '+JSON.stringify(await evaluate(`({index:${i},active:document.activeElement.tagName,id:document.activeElement.id,open:document.getElementById('field-results-dialog').open,modal:document.getElementById('field-results-dialog').matches(':modal'),hasFocus:document.hasFocus()})`)));
  }
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await waitFor(`!document.getElementById('field-results-dialog').open&&!document.documentElement.classList.contains('results-open')`);

  // Select the current persisted location as an unsaved candidate, then exercise
  // failure/retry. POST interception guarantees no database writes happen here.
  await evaluate(`(()=>{const p=JSON.parse(document.getElementById('map-config').textContent);document.querySelector('[data-dialog=location-dialog]').click();document.getElementById('manual-latitude').value=p.latitude;document.getElementById('manual-longitude').value=p.longitude;document.getElementById('coordinate-form').requestSubmit();})()`);
  const cleared=await evaluate(`document.getElementById('crop-top').textContent===''&&document.getElementById('weather-temperature').textContent==='\u2014'`);
  if(!cleared)throw new Error('Selecting a pin retained old results');
  await evaluate(`document.getElementById('view-field-results').click()`);
  await waitFor(`!document.getElementById('view-field-results').disabled`);
  if(posts.length!==1||await evaluate(`document.getElementById('field-results-dialog').open`))throw new Error('Failed save opened results or was not attempted');
  saveMode='success';
  await evaluate(`document.getElementById('view-field-results').click();document.getElementById('view-field-results').click()`);
  await waitFor(`document.getElementById('field-results-dialog').open`);
  if(posts.length!==2)throw new Error('Retry or duplicate-save protection failed');
  await evaluate(`document.querySelector('.results-close').click();document.getElementById('language-toggle').click();document.querySelector('[data-language=lo]').click()`);
  const laoLabel=await evaluate(`document.querySelector('.pin-results-label').textContent`);
  if(laoLabel!=='ເບິ່ງຜົນ')throw new Error('Pin action did not translate: '+laoLabel);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await new Promise(resolve=>setTimeout(resolve,400));
  const mobile=await evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,height:document.documentElement.scrollHeight,viewport:innerHeight,pin:(()=>{const r=document.querySelector('.pin-results-button').getBoundingClientRect();return{x:r.x,right:r.right,height:r.height};})()})`);
  if(mobile.overflow||mobile.height>mobile.viewport+360||mobile.pin.x<0||mobile.pin.right>390||mobile.pin.height<64)throw new Error(JSON.stringify(mobile));
  await screenshot('map-lao-mobile');
  await evaluate(`document.querySelector('.pin-results-button').click()`);
  await waitFor(`document.getElementById('field-results-dialog').open`);
  const mobilePopup=await evaluate(`({heading:document.getElementById('field-results-title').textContent,width:document.getElementById('field-results-dialog').getBoundingClientRect().width,overflow:document.getElementById('results-scroll-area').scrollWidth>document.getElementById('results-scroll-area').clientWidth,tabs:[...document.querySelectorAll('[role=tab]')].map(t=>({text:t.textContent,height:t.getBoundingClientRect().height}))})`);
  if(mobilePopup.overflow||mobilePopup.width>390||!mobilePopup.heading.includes('ຜົນ')||mobilePopup.tabs.some(t=>t.height<48||/[A-Za-z]/.test(t.text)))throw new Error(JSON.stringify(mobilePopup));
  await screenshot('results-lao-mobile');
  await evaluate(`document.querySelector('.results-close').click()`);
  await call('Page.navigate',{url:'http://127.0.0.1:8000/map/?guest_entry=1#gaez-explorer'});
  await waitFor(`document.getElementById('field-results-dialog')?.open`);
  const bookmark=await evaluate(`document.querySelector('[role=tab][aria-selected=true]').dataset.resultsTab`);
  if(bookmark!=='crops'||errors.length)throw new Error(JSON.stringify({bookmark,errors}));
  console.log(JSON.stringify({main,font,popup,cropResults,cleared,saveAttempts:posts.length,laoLabel,mobile,mobilePopup,bookmark,errors,screenshots:directory},null,2));
  await call('Browser.close');
}finally{socket?.close();chrome.kill();}
