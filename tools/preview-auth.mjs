// Real account creation/sign-in in an isolated SQLite database, plus layout QA.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory=mkdtempSync(join(tmpdir(),'mekongrise-auth-'));
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
    '--remote-debugging-port=9229',`--user-data-dir=${directory}`,'about:blank',
  ],{windowsHide:true,stdio:'ignore'});
  let pages;
  for(let i=0;i<40;i++){
    try{pages=await(await fetch('http://127.0.0.1:9229/json')).json();break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}
  }
  if(!pages)throw new Error('QA browser did not start');
  socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map(),errors=[];
  const call=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));});
  socket.onmessage=event=>{const data=JSON.parse(event.data);if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.text);if(pending.has(data.id)){const {resolve,reject}=pending.get(data.id);pending.delete(data.id);if(data.error)reject(new Error(data.error.message));else resolve(data.result);}};
  const evaluate=async expression=>{const response=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));return response.result.value;};
  const act=expression=>evaluate('(()=>{'+expression+';return true;})()');
  const waitFor=async expression=>{const end=Date.now()+20000;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,150));}throw new Error('Timed out: '+expression+' at '+await evaluate(`JSON.stringify({href:location.href,ready:document.readyState,entry:sessionStorage.getItem('mekongrise-guest-entry')})`));};
  const screenshot=async name=>{const data=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(directory,name+'.png'),Buffer.from(data.data,'base64'));};
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  const navigate=async path=>{await call('Page.navigate',{url:base+path});await waitFor(`document.readyState==='complete'`);};
  await call('Page.enable');await call('Runtime.enable');
  await call('Browser.setPermission',{origin:base,permission:{name:'geolocation'},setting:'denied'});
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await navigate('/');
  await waitFor(`location.pathname==='/login/'&&!!document.getElementById('auth-form')`);
  const background=await evaluate(`(async()=>{const css=getComputedStyle(document.body,'::before').backgroundImage;const image=new Image();image.src='/static/website/login-farm.jpg';await image.decode();return{css,width:image.naturalWidth};})()`);
  assert(background.css.includes('login-farm.jpg')&&background.width>=1200,'Farm background did not load');
  assert(await evaluate(`!document.querySelector('.auth-photo')&&!document.body.textContent.includes('Know your land.')&&!document.body.textContent.includes('Plan a better growing season.')&&!document.body.textContent.includes('ROOTED IN THE MEKONG')`),'Removed photo or text is still present');
  const desktop=await evaluate(`({title:document.title,brand:document.querySelector('h1').textContent,slogan:document.querySelector('.auth-slogan').textContent,overflow:document.documentElement.scrollWidth>innerWidth,height:document.documentElement.scrollHeight,viewport:innerHeight,submit:document.querySelector('.auth-submit').getBoundingClientRect().height,stackedBenefits:(()=>{const items=[...document.querySelectorAll('.auth-benefits>div')].map(n=>n.getBoundingClientRect());return items.length===3&&items[0].bottom<=items[1].top+.5&&items[1].bottom<=items[2].top+.5;})(),formOnRight:document.querySelector('.auth-panel').getBoundingClientRect().left>document.querySelector('.auth-story').getBoundingClientRect().right})`);
  assert(desktop.stackedBenefits&&desktop.formOnRight,'Layout does not match the reference drawing');
  assert(desktop.brand==='MekongRise'&&!desktop.overflow&&desktop.height<=desktop.viewport+30&&desktop.submit>=50,'Desktop layout: '+JSON.stringify(desktop));
  const introduction=await evaluate(`({background:getComputedStyle(document.querySelector('.auth-benefits')).backgroundColor,cursor:getComputedStyle(document.querySelector('.auth-benefits>div')).cursor,controls:document.querySelectorAll('.auth-benefits button,.auth-benefits a,.auth-benefits [role=button]').length})`);
  assert(introduction.background==='rgb(38, 77, 57)'&&introduction.cursor==='default'&&introduction.controls===0,'Introduction still resembles controls');
  await screenshot('login-desktop');
  await act(`document.getElementById('id_password').value='not-a-real-password';document.querySelector('[data-password-toggle]').click()`);
  assert(await evaluate(`document.getElementById('id_password').type==='text'&&document.querySelector('[data-password-toggle]').getAttribute('aria-pressed')==='true'`),'Password reveal failed');
  await act(`document.querySelector('[data-password-toggle]').click();document.getElementById('id_password').value='';document.getElementById('language-toggle').click();document.querySelector('[data-language=lo]').click()`);
  assert(await evaluate(`document.getElementById('auth-heading').textContent.includes('ເຂົ້າ')`),'Lao login translation failed');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await new Promise(resolve=>setTimeout(resolve,200));
  const mobile=await evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,email:document.getElementById('id_username').getBoundingClientRect().height,guest:document.querySelector('.auth-guest').textContent,heading:document.getElementById('auth-heading').textContent})`);
  assert(!mobile.overflow&&mobile.email>=50,'Mobile layout failed');
  await screenshot('login-lao-mobile');
  await act(`document.getElementById('language-toggle').click();document.querySelector('[data-language=th]').click()`);
  assert(await evaluate(`document.getElementById('auth-heading').textContent.includes('เข้าสู่ระบบ')`),'Thai login translation failed');
  await act(`document.getElementById('language-toggle').click();document.querySelector('[data-language=en]').click()`);
  const password='Field!'+randomBytes(15).toString('hex');
  const email='farmer-browser@example.test';
  await act(`document.getElementById('id_username').value='unknown@example.test';document.getElementById('id_password').value='incorrect-passphrase';document.getElementById('auth-form').requestSubmit()`);
  await waitFor(`!!document.querySelector('[data-auth-errors]')`);
  assert(await evaluate(`document.querySelector('[data-auth-errors]').textContent.includes('email, phone number or password')&&document.getElementById('id_password').value===''&&!document.querySelector('.auth-submit').disabled`),'Failed-login state did not reset');
  await navigate('/signup/');
  await screenshot('signup-mobile');
  await act(`document.getElementById('id_email').value=${JSON.stringify(email)};document.getElementById('id_phone').value='020 5555 1234';document.getElementById('id_password1').value=${JSON.stringify(password)};document.getElementById('id_password2').value=${JSON.stringify(password)};document.getElementById('auth-form').requestSubmit()`);
  await waitFor(`location.pathname==='/map/'&&!!document.querySelector('.profile-button')`);
  const account=await evaluate(`(async()=>{const data=await(await fetch('/api/dashboard/')).json();return{authenticated:!!document.querySelector('.account-logout'),latitude:data.field.latitude,events:data.events.length,brand:document.querySelector('.brand').textContent};})()`);
  assert(account.authenticated&&account.latitude===null&&account.events===0&&account.brand.includes('MekongRise'),'Account did not get a new workspace');
  await act(`document.querySelector('.profile-button').click()`);
  await waitFor(`document.getElementById('profile-dialog').open`);
  assert(await evaluate(`document.getElementById('profile-dialog').textContent.includes('+8562055551234')&&document.getElementById('profile-dialog').textContent.includes(${JSON.stringify(email)})&&!document.querySelector('.account-button')`),'Profile details or header state are incorrect');
  await screenshot('profile-mobile');
  await act(`document.querySelector('.profile-signout').click()`);
  await waitFor(`location.pathname==='/login/'&&!!document.getElementById('auth-form')`);
  await act(`document.getElementById('id_username').value=${JSON.stringify(email.toUpperCase())};document.getElementById('id_password').value=${JSON.stringify(password)};document.getElementById('auth-form').requestSubmit()`);
  await waitFor(`location.pathname==='/map/'&&!!document.querySelector('.profile-button')`);
  const cookies=await call('Network.getCookies',{urls:[base]});
  assert(cookies.cookies.some(cookie=>cookie.name==='sessionid'&&cookie.expires>Date.now()/1000+28*86400),'Sign-in cookie does not survive browser restart');
  await navigate('/');
  await waitFor(`location.pathname==='/map/'&&!!document.querySelector('.profile-button')`);
  await navigate('/login/');
  await waitFor(`location.pathname==='/map/'&&!!document.querySelector('.profile-button')`);
  await act(`document.querySelector('.profile-button').click();document.querySelector('.profile-signout').click()`);
  await waitFor(`location.pathname==='/login/'&&!!document.querySelector('.auth-guest')`);
  await act(`document.getElementById('id_username').value='+856 20 5555 1234';document.getElementById('id_password').value=${JSON.stringify(password)};document.getElementById('auth-form').requestSubmit()`);
  await waitFor(`location.pathname==='/map/'&&!!document.querySelector('.profile-button')`);
  await act(`document.querySelector('.profile-button').click();document.querySelector('.profile-signout').click()`);
  await waitFor(`location.pathname==='/login/'&&!!document.querySelector('.auth-guest')`);
  await navigate('/');
  await waitFor(`location.pathname==='/login/'&&!!document.querySelector('.auth-guest')`);
  await act(`document.querySelector('.auth-guest').click()`);
  await waitFor(`location.pathname==='/map/'&&document.readyState==='complete'&&!!document.getElementById('live-map')`);
  assert(await evaluate(`!document.querySelector('.account-logout')&&document.querySelector('.account-button').textContent.includes('Sign in')`),'Guest map was not available after logout');
  assert(await evaluate(`!location.search.includes('guest_entry')&&sessionStorage.getItem('mekongrise-guest-entry')===null`),'Guest entry was not consumed');
  await call('Page.reload',{ignoreCache:true});
  await waitFor(`location.pathname==='/login/'&&!!document.getElementById('auth-form')`);
  await navigate('/map/');
  await waitFor(`location.pathname==='/login/'&&!!document.querySelector('.auth-guest')`);
  await act(`document.querySelector('.auth-guest').click()`);
  await waitFor(`location.pathname==='/map/'&&document.readyState==='complete'&&!!document.getElementById('live-map')`);
  await act(`document.querySelector('.calendar-nav a').click()`);
  await waitFor(`location.pathname==='/map/'&&location.search.includes('month=')&&!!document.getElementById('live-map')`);
  await call('Page.reload',{ignoreCache:true});
  await waitFor(`location.pathname==='/login/'&&!!document.querySelector('.auth-guest')`);
  await act(`document.getElementById('id_username').value=${JSON.stringify(email)};document.getElementById('id_password').value=${JSON.stringify(password)};document.getElementById('auth-form').requestSubmit()`);
  await waitFor(`location.pathname==='/map/'&&!!document.querySelector('.profile-button')`);
  await call('Page.reload',{ignoreCache:true});
  await waitFor(`location.pathname==='/map/'&&!!document.querySelector('.profile-button')`);
  assert(errors.length===0,'Browser errors: '+errors.join(', '));
  console.log(JSON.stringify({isolatedDatabase:true,introduction,guestRefreshReturnsToLogin:true,directGuestVisitReturnsToLogin:true,guestCalendarWorks:true,signedInRefreshStaysHome:true,background,desktop,mobile,realSignupAndEmailAndPhoneLogin:true,returningAccountSkipsLogin:true,persistentCookie:true,profileDialog:true,logout:true,publicMap:true,passwordToggle:true,translatedLanguages:['en','lo','th'],errors,screenshots:directory},null,2));
}finally{socket?.close();chrome?.kill();server.kill();}
