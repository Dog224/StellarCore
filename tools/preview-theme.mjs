// Real account creation/sign-in in an isolated SQLite database, plus layout QA.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory=mkdtempSync(join(tmpdir(),'mekongrise-theme-'));
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
    '--remote-debugging-port=9233',`--user-data-dir=${directory}`,'about:blank',
  ],{windowsHide:true,stdio:'ignore'});
  let pages;
  for(let i=0;i<40;i++){
    try{pages=await(await fetch('http://127.0.0.1:9233/json')).json();break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}
  }
  if(!pages)throw new Error('QA browser did not start');
  socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map(),errors=[];
  const call=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));});
  socket.onmessage=event=>{const data=JSON.parse(event.data);if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);if(pending.has(data.id)){const {resolve,reject}=pending.get(data.id);pending.delete(data.id);if(data.error)reject(new Error(data.error.message));else resolve(data.result);}};
  const evaluate=async expression=>{const response=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));return response.result.value;};
  const act=expression=>evaluate('(()=>{'+expression+';return true;})()');
  const waitFor=async expression=>{const end=Date.now()+20000;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,150));}throw new Error('Timed out: '+expression+' at '+await evaluate(`JSON.stringify({href:location.href,ready:document.readyState,entry:sessionStorage.getItem('mekongrise-guest-entry')})`));};
  const screenshot=async name=>{const data=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(directory,name+'.png'),Buffer.from(data.data,'base64'));};
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  const navigate=async path=>{await call('Page.navigate',{url:base+path});await waitFor(`document.readyState==='complete'`);};
  await call('Page.enable');await call('Runtime.enable');
  await call('Browser.setPermission',{origin:base,permission:{name:'geolocation'},setting:'denied'});
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});

  await call('Page.addScriptToEvaluateOnNewDocument',{source:"document.addEventListener('DOMContentLoaded',()=>window.__qaDOMReady=true);"});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
  await navigate('/login/');
  await waitFor(`document.readyState==='complete'&&!!document.querySelector('[data-theme-toggle]')`);
  assert(await evaluate(`document.documentElement.dataset.theme==='dark'`),'Initial system preference was ignored');
  await act(`document.querySelector('[data-theme-toggle]').focus()`);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await waitFor(`document.documentElement.dataset.theme==='light'`);
  await call('Page.reload',{ignoreCache:true});
  await waitFor(`document.readyState==='complete'&&!!document.querySelector('[data-theme-toggle]')`);
  assert(await evaluate(`document.documentElement.dataset.theme==='light'&&localStorage.getItem('mekongrise-theme')==='light'`),'Choice did not survive refresh or override the OS preference');
  await act(`document.querySelector('[data-theme-toggle]').click()`);
  await new Promise(resolve=>setTimeout(resolve,650));
  await screenshot('login-dark');
  await act(`document.querySelector('.auth-guest').click()`);
  await waitFor(`location.pathname==='/map/'&&window.__qaDOMReady&&!!document.getElementById('live-map')`);
  const dark=await evaluate(`({theme:document.documentElement.dataset.theme,background:getComputedStyle(document.querySelector('.home-shell')).backgroundColor,text:getComputedStyle(document.querySelector('.home-greeting h1')).color,fixedButtons:document.querySelectorAll('.map-results-button').length,buttonBesideLanguage:document.querySelector('[data-theme-toggle]').getBoundingClientRect().right<=document.getElementById('language-toggle').getBoundingClientRect().left,overflow:document.documentElement.scrollWidth>innerWidth})`);
  assert(dark.theme==='dark'&&dark.fixedButtons===0&&dark.buttonBesideLanguage&&!dark.overflow,'Dark home or removed-button regression: '+JSON.stringify(dark));
  const contrast=(foreground,background)=>{
    const lum=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(v=>{const c=Number(v)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
    const a=lum(foreground),b=lum(background);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  };
  const ratio=contrast(dark.text,dark.background);assert(ratio>=4.5,'Dark text contrast is too low: '+ratio);
  await act(`document.querySelector('[data-dialog="location-dialog"]').click();document.getElementById('manual-latitude').value=18.01616;document.getElementById('manual-longitude').value=102.64890;document.getElementById('coordinate-form').requestSubmit()`);
  await waitFor(`document.querySelectorAll('.pin-results-button').length===1&&!!document.getElementById('view-field-results')`);
  assert(await evaluate(`!!document.getElementById('view-field-results').closest('.pin-results-marker')&&!document.querySelector('.map-results-button')`),'Result control is not exclusively attached to the pin');
  await new Promise(resolve=>setTimeout(resolve,400));await screenshot('home-dark');
  await act(`document.getElementById('view-field-results').click()`);
  await waitFor(`document.getElementById('field-results-dialog').open`);
  await new Promise(resolve=>setTimeout(resolve,500));
  const results=await evaluate(`({background:getComputedStyle(document.getElementById('field-results-dialog')).backgroundColor,text:getComputedStyle(document.getElementById('field-results-title')).color,photoFilter:getComputedStyle(document.querySelector('.crop-photo img')||document.querySelector('.field-photo')).filter})`);
  assert(contrast(results.text,results.background)>=4.5&&results.photoFilter==='none','Results contrast or photographs changed');
  const note=await evaluate(`({text:getComputedStyle(document.querySelector('.crop-uncertainty')).color,background:getComputedStyle(document.querySelector('.crop-uncertainty')).backgroundColor})`);
  assert(contrast(note.text,note.background)>=4.5,'Dark crop note is not readable');
  await screenshot('results-dark');
  await act(`document.querySelector('.results-close').click();document.getElementById('language-toggle').click();document.querySelector('[data-language=lo]').click()`);
  assert(await evaluate(`!document.querySelector('[data-theme-toggle]').getAttribute('aria-label').includes('Switch')`),'Theme action is not translated');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await new Promise(resolve=>setTimeout(resolve,300));
  const mobile=await evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,toggle:document.querySelector('[data-theme-toggle]').getBoundingClientRect().height,tilesFiltered:[...document.querySelectorAll('.leaflet-tile')].some(tile=>getComputedStyle(tile).filter!=='none')})`);
  const rail=await evaluate(`({text:getComputedStyle(document.querySelector('.home-sidebar nav a:not(.active)')).color,background:getComputedStyle(document.querySelector('.home-sidebar')).backgroundColor})`);
  assert(contrast(rail.text,rail.background)>=4.5,'Mobile dark navigation is not readable');
  assert(!mobile.overflow&&mobile.toggle>=44&&!mobile.tilesFiltered,'Mobile theme or imagery regression: '+JSON.stringify(mobile));
  await screenshot('home-dark-lao-mobile');
  await act(`document.querySelector('[data-theme-toggle]').click()`);
  assert(await evaluate(`document.documentElement.dataset.theme==='light'&&localStorage.getItem('mekongrise-theme')==='light'`),'Could not return to light mode');
  await new Promise(resolve=>setTimeout(resolve,250));await screenshot('home-light-mobile');
  assert(errors.length===0,'Browser errors: '+errors.join(', '));
  console.log(JSON.stringify({isolatedDatabase:true,systemPreference:true,keyboardToggle:true,savedPreference:true,dark,contrastRatio:ratio,results,mobile,pinResultsWork:true,lightModeRestored:true,lao:true,errors,screenshots:directory},null,2));
}finally{socket?.close();chrome?.kill();server.kill();}
