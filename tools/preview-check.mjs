import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'terragrow-preview-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9223', `--user-data-dir=${directory}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let socket;
const fixtureIndex = process.argv.indexOf('--weather-fixture');
const weatherFixture = fixtureIndex >= 0 ? JSON.parse(readFileSync(process.argv[fixtureIndex + 1], 'utf8')) : null;
let weatherPayload = weatherFixture;
try {
  let pages;
  for (let i = 0; i < 40; i++) {
    try { pages = await (await fetch('http://127.0.0.1:9223/json')).json(); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  if (!pages) throw new Error('Preview browser did not start');
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.method === 'Fetch.requestPaused') {
      if(data.params.request.url.includes('/api/weather/history/')){
        call('Fetch.continueRequest',{requestId:data.params.requestId});return;
      }
      call('Fetch.fulfillRequest', {
        requestId: data.params.requestId, responseCode: 200,
        responseHeaders: [{name:'Content-Type',value:'application/json'}],
        body: Buffer.from(JSON.stringify(weatherPayload)).toString('base64'),
      }).catch(error => { throw error; });
      return;
    }
    if (pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message)); else resolve(data.result);
    }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const current = ++id;
    pending.set(current, { resolve, reject });
    socket.send(JSON.stringify({ id: current, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await call('Page.enable');
  if (weatherFixture) await call('Fetch.enable', { patterns: [{urlPattern:'*/api/weather/*'}] });
  await call('Browser.grantPermissions', { origin: 'http://127.0.0.1:8000', permissions: ['geolocation'] });
  await call('Emulation.setGeolocationOverride', { latitude: 13.7563, longitude: 100.5018, accuracy: 25 });
  await call('Emulation.setDeviceMetricsOverride', { width: 1536, height: 1024, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: 'http://127.0.0.1:8000/map/?guest_entry=1' });
  await new Promise(resolve => setTimeout(resolve, 2500));
  const desktop = await evaluate(`({title:document.title, overflow:document.documentElement.scrollWidth>innerWidth, images:[...document.images].filter(i=>!i.classList.contains('leaflet-tile')&&i.getClientRects().length).every(i=>i.complete&&i.naturalWidth>0), heading:document.querySelector('h1').textContent})`);
  if (desktop.overflow || !desktop.images || desktop.heading !== 'Hello, Farmer!') throw new Error(JSON.stringify(desktop));
  // Simulate a browser translator reacting to app-generated DOM writes. A bounded
  // loop makes the former whole-page MutationObserver bug fail without hanging QA.
  const responsiveness=await evaluate(`new Promise(resolve=>{
    const probe=document.createElement('div');probe.hidden=true;
    const started=performance.now();let codeRewrites=0;
    const translator=new MutationObserver(()=>{
      codeRewrites++;
      if(codeRewrites>=100){translator.disconnect();return;}
      probe.textContent='external translation '+codeRewrites;
    });
    translator.observe(document.getElementById('language-code'),{childList:true,subtree:true});
    document.body.append(probe);
    for(let i=0;i<200;i++){const tile=document.createElement('span');tile.textContent='map update '+i;probe.append(tile);}
    setTimeout(()=>{translator.disconnect();probe.remove();resolve({codeRewrites,elapsed:performance.now()-started,translationOptOut:document.documentElement.getAttribute('translate')==='no'});},100);
  })`);
  if(responsiveness.codeRewrites!==0||responsiveness.elapsed>1000||!responsiveness.translationOptOut)throw new Error(JSON.stringify(responsiveness));
  await evaluate(`document.dispatchEvent(new CustomEvent('field-results-ready',{detail:{tab:'crops'}}))`);
  await new Promise(resolve=>setTimeout(resolve,400));
  let weatherCheck = null;
  // Weekly readings now start when the farmer actually opens Weather & soil.
  await evaluate(`document.querySelector('[data-results-tab=weather]').click()`);
  for(let i=0;i<100;i++){
    if(await evaluate(`document.getElementById('insights').getAttribute('aria-busy')==='false'`))break;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if (weatherFixture) {
    weatherCheck = await evaluate(`({rows:document.querySelectorAll('#weather-days tr').length,temperature:document.getElementById('weather-temperature').textContent,period:document.getElementById('weather-period').textContent})`);
    if (weatherCheck.rows !== 7 || !weatherCheck.temperature.includes(String(weatherFixture.temperature_c.toFixed(1))) || !weatherCheck.period.includes('UTC')) throw new Error(JSON.stringify(weatherCheck));
    if (weatherFixture.soil_moisture?.status === 'ok') {
      const soil=await evaluate(`({surface:document.getElementById('weather-soil-surface').textContent,root:document.getElementById('weather-soil-root').textContent,note:document.getElementById('weather-soil-note').textContent,columns:document.querySelectorAll('#weather-days tr:first-child td').length})`);
      if(!soil.surface.includes(weatherFixture.soil_moisture.surface.toFixed(2))||!soil.note.includes(weatherFixture.soil_moisture.date)||soil.columns!==9)throw new Error(JSON.stringify(soil));
      weatherCheck.soil=soil;
    }
  }
  await evaluate(`document.getElementById('field-results-dialog').close()`);
  const location = await evaluate(`({status:document.getElementById('map-status').textContent, tiles:[...document.querySelectorAll('.leaflet-tile')].filter(i=>i.complete&&i.naturalWidth>0).length,marker:!!document.querySelector('.field-map-marker'),fakeBoundary:!!document.querySelector('.field-shape')})`);
  if (!location.status.includes('Your location found') || !location.marker || location.fakeBoundary) throw new Error(JSON.stringify(location));
  // Wait for external imagery separately from geolocation; report a service/network limit explicitly.
  for (let i=0;i<20 && location.tiles===0;i++) {
    await new Promise(resolve=>setTimeout(resolve,500));
    location.tiles=await evaluate(`[...document.querySelectorAll('.leaflet-tile')].filter(i=>i.complete&&i.naturalWidth>0).length`);
  }
  if (!location.tiles) throw new Error('No real satellite tiles loaded');
  for (let i=0;i<30;i++) {
    if (await evaluate(`[...document.querySelectorAll('.leaflet-tile')].every(i=>i.complete)`)) break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(directory, 'desktop.png'), Buffer.from(image.data, 'base64'));
  // No crop, climate-model, indicator, or management input is needed for this run.
  for (let i=0;i<200;i++) {
    if(await evaluate(`document.getElementById('crop-recommendations').getAttribute('aria-busy')==='false'`)) break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  const automaticCheck=await evaluate(`({cards:document.querySelectorAll('.ranked-crop').length,crops:document.querySelectorAll('#crop-top article').length,advancedClosed:!document.getElementById('gaez-advanced').open,technicalCards:document.querySelectorAll('.gaez-theme').length,results:[...document.querySelectorAll('.ranked-crop')].map(card=>({name:card.querySelector('h3>span').textContent,score:Number(card.dataset.score),level:card.dataset.level,source:!!card.querySelector('a[href^="https://ecocrop.apps.fao.org/"]')}))})`);
  if(automaticCheck.cards!==13||automaticCheck.crops<1||!automaticCheck.advancedClosed||automaticCheck.technicalCards!==0||automaticCheck.results.some(card=>!card.source||!card.level))throw new Error(JSON.stringify(automaticCheck));
  await evaluate(`document.dispatchEvent(new CustomEvent('field-results-ready',{detail:{tab:'crops'}}));document.getElementById('gaez-explorer').scrollIntoView()`);
  const automaticImage=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(join(directory,'automatic.png'),Buffer.from(automaticImage.data,'base64'));
  await evaluate(`document.getElementById('field-results-dialog').close()`);
  const interaction = await evaluate(`(() => {
    document.querySelector('[data-layer=rainfall]').click();
    const layer=document.getElementById('map').classList.contains('rainfall')&&!document.getElementById('layer-legend').hidden;
    document.querySelector('[data-layer=satellite]').click();
    document.querySelector('[data-dialog=field-dialog]').click();
    const dialog=document.getElementById('field-dialog').open;
    document.querySelector('#field-dialog [data-close]').click();
    document.querySelector('[data-date]').click();
    const date=document.querySelector('#event-dialog input[name=date]').value;
    const eventDialog=document.getElementById('event-dialog').open;
    document.querySelector('#event-dialog [data-close]').click();
    return {layer,dialog,date,eventDialog};
  })()`);
  if (!interaction.layer || !interaction.dialog || !interaction.date || !interaction.eventDialog) throw new Error(JSON.stringify(interaction));
  const coordinates = await evaluate(`(() => {
    document.querySelector('[data-dialog=location-dialog]').click();
    document.getElementById('manual-latitude').value='14.1';
    document.getElementById('manual-longitude').value='100.2';
    document.getElementById('coordinate-form').requestSubmit();
    return {closed:!document.getElementById('location-dialog').open,status:document.getElementById('map-status').textContent,canSave:!document.getElementById('save-location').disabled};
  })()`);
  if (!coordinates.closed || !coordinates.status.includes('14.10000, 100.20000') || !coordinates.canSave) throw new Error(JSON.stringify(coordinates));
  const selectedPinCleared=await evaluate(`document.getElementById('weather-temperature').textContent==='\u2014'&&document.getElementById('weather-status').textContent.includes('Save this pin')`);
  if(!selectedPinCleared)throw new Error('Unsaved pin retained readings from previous location');
  if(!await evaluate(`document.querySelectorAll('.ranked-crop').length===0&&document.getElementById('crop-top').textContent===''&&document.getElementById('crop-status').textContent.includes('Save this pin')`))throw new Error('Unsaved pin retained an automatic recommendation');
  await evaluate(`document.getElementById('assessment-ph').value='6';document.getElementById('assessment-drainage').value='poor';document.dispatchEvent(new CustomEvent('field-location-saved'))`);
  await new Promise(resolve=>setTimeout(resolve,400));
  const clearedInputs=await evaluate(`document.getElementById('assessment-ph').value===''&&document.getElementById('assessment-drainage').value==='unknown'`);
  if(!clearedInputs)throw new Error('Soil observations were copied to a new pin');
  await evaluate(`document.dispatchEvent(new CustomEvent('field-results-ready',{detail:{tab:'crops'}}));document.getElementById('gaez-explorer').scrollIntoView();document.getElementById('gaez-advanced').open=true`);
  for(let i=0;i<60;i++){
    if(await evaluate(`document.querySelectorAll('.gaez-theme').length===6`))break;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  const gaezControls=await evaluate(`(() => {
    const cards=[...document.querySelectorAll('.gaez-theme')];
    for(const card of cards){
      const crop=card.querySelector('select[name^=dim_CROP]');
      if(crop){crop.value=crop.name.includes('RES02')?'MAIZ':'MZE';card.querySelector('form').requestSubmit();}
    }
    return {themes:cards.length,indicators:cards.reduce((sum,card)=>sum+card.querySelector('select[name=layer]').options.length,0)};
  })()`);
  if(gaezControls.themes!==6||gaezControls.indicators<6)throw new Error(JSON.stringify(gaezControls));
  for(let i=0;i<100;i++){
    if(await evaluate(`[...document.querySelectorAll('.gaez-theme')].every(card=>card.getAttribute('aria-busy')!=='true')`))break;
    await new Promise(resolve=>setTimeout(resolve,400));
  }
  const gaezCheck=await evaluate(`[...document.querySelectorAll('.gaez-theme')].map(card=>({title:card.querySelector('h3').textContent,value:card.querySelector('.gaez-value').textContent,note:card.querySelector('.gaez-note').textContent,source:!!card.querySelector('a[href^="https://storage.googleapis.com/"]')}))`);
  if(gaezCheck.some(card=>card.value==='\u2014'||!card.source))throw new Error(JSON.stringify(gaezCheck));
  const gaezScreenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(join(directory,'gaez.png'),Buffer.from(gaezScreenshot.data,'base64'));
  await evaluate(`document.getElementById('field-results-dialog').close()`);
  await evaluate('window.scrollTo(0,0)');
  const assessmentCheck=await evaluate(`({title:document.getElementById('assessment-badge').textContent,checks:document.querySelectorAll('#assessment-checks li').length,health:document.querySelector('.assessment-health strong').textContent,imerg:document.getElementById('imerg-status').textContent})`);
  if(weatherFixture?.assessment && (assessmentCheck.health!=='Not determined'||assessmentCheck.checks<3))throw new Error(JSON.stringify(assessmentCheck));
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate('window.scrollTo(0,0)');
  await new Promise(resolve => setTimeout(resolve, 800));
  for (let i=0;i<30;i++) {
    if (await evaluate(`[...document.querySelectorAll('.leaflet-tile')].every(i=>i.complete)`)) break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  const mobile = await evaluate('({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,width:document.documentElement.clientWidth,bodyWidth:document.documentElement.scrollWidth})');
  if (mobile.overflow) throw new Error(JSON.stringify(mobile));
  const mobileImage = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(directory, 'mobile.png'), Buffer.from(mobileImage.data, 'base64'));
  if (weatherFixture) {
    weatherPayload={status:'unavailable',message:'NASA data is temporarily unavailable.'};
    await evaluate(`document.getElementById('weather-refresh').click()`);
    await new Promise(resolve=>setTimeout(resolve,300));
    const failure=await evaluate(`({status:document.getElementById('weather-status').textContent,hidden:document.getElementById('weather-details').hidden,temperature:document.getElementById('weather-temperature').textContent})`);
    if (!failure.status.includes('unavailable') || !failure.hidden || failure.temperature !== '\u2014') throw new Error(JSON.stringify(failure));
    weatherPayload=weatherFixture;
    await evaluate(`document.dispatchEvent(new CustomEvent('field-location-saved'))`);
    await new Promise(resolve=>setTimeout(resolve,300));
    const refreshed=await evaluate(`document.querySelectorAll('#weather-days tr').length`);
    if (refreshed!==7) throw new Error('Weather did not reload after saving field location');
    weatherCheck.failureHandled=true;
    weatherCheck.pinChangeRefreshed=true;
  }
  await call('Browser.setPermission', { origin:'http://127.0.0.1:8000', permission:{name:'geolocation'}, setting:'denied' });
  await call('Page.reload');
  await new Promise(resolve=>setTimeout(resolve,1000));
  const denied=await evaluate(`document.getElementById('map-status').textContent`);
  if (!denied.includes('permission was denied')) throw new Error(denied);
  const languageCheck = await evaluate(`new Promise(resolve => {
    document.getElementById('language-toggle').click();
    const opened=!document.getElementById('language-menu').hidden;
    document.querySelector('[data-language=th]').click();
    document.querySelector('[data-dialog=field-dialog]').click();
    const formLabel=document.querySelector('label[for=id_name]').textContent;
    const inputValue=document.getElementById('id_name').value;
    document.querySelector('#field-dialog [data-close]').click();
    document.getElementById('weather-status').textContent='Save your field pin to load NASA weather data.';
    window.TerraGrowI18n.refresh(document.getElementById('weather-status'));
    setTimeout(()=>resolve({opened,language:document.documentElement.lang,heading:document.querySelector('h1').textContent,formLabel,inputValue,status:document.getElementById('weather-status').textContent,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}),50);
  })`);
  if (!languageCheck.opened || languageCheck.language!=='th' || !languageCheck.heading.includes('สวัสดี') || !languageCheck.formLabel.includes('ชื่อ') || languageCheck.status.includes('Save your') || languageCheck.overflow) throw new Error(JSON.stringify(languageCheck));
  const thaiImage=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(join(directory,'thai-mobile.png'),Buffer.from(thaiImage.data,'base64'));
  await evaluate(`document.getElementById('language-toggle').click();document.querySelector('[data-language=lo]').click()`);
  await call('Page.reload');
  await new Promise(resolve=>setTimeout(resolve,700));
  const lao=await evaluate(`({language:document.documentElement.lang,heading:document.querySelector('h1').textContent,input:document.getElementById('id_name').value,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,menuClosed:document.getElementById('language-menu').hidden})`);
  if(lao.language!=='lo'||!lao.heading.includes('ສະບາຍດີ')||lao.input!==languageCheck.inputValue||lao.overflow||!lao.menuClosed)throw new Error(JSON.stringify(lao));
  await call('Emulation.setDeviceMetricsOverride',{width:1536,height:1024,deviceScaleFactor:1,mobile:false});
  await evaluate('window.scrollTo(0,0)');
  await new Promise(resolve=>setTimeout(resolve,500));
  const laoImage=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(join(directory,'lao-desktop.png'),Buffer.from(laoImage.data,'base64'));
  await evaluate(`document.getElementById('language-toggle').click()`);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  const escaped=await evaluate(`document.getElementById('language-menu').hidden&&document.activeElement===document.getElementById('language-toggle')`);
  if(!escaped)throw new Error('Language menu Escape handling failed');
  await evaluate(`document.getElementById('language-toggle').click();document.querySelector('[data-language=en]').click()`);
  const english=await evaluate(`document.querySelector('h1').textContent`);
  if(english!=='Hello, Farmer!')throw new Error('English did not restore');
  console.log(JSON.stringify({ desktop, responsiveness, location, interaction, coordinates, mobile, weatherCheck, automaticCheck, gaezControls, gaezCheck, assessmentCheck, selectedPinCleared, clearedInputs, denied, languageCheck, lao, escaped, english, screenshots: directory }, null, 2));
  await call('Browser.close');
} finally {
  socket?.close();
  chrome.kill();
}
