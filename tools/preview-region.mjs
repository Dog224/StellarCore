// Country-limit browser QA. Never save a valid pin to the user's database.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'terragrow-region-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9226', `--user-data-dir=${directory}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let socket;
try {
  let pages;
  for (let i = 0; i < 40; i++) {
    try { pages = await (await fetch('http://127.0.0.1:9226/json')).json(); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  if (!pages) throw new Error('QA Chrome did not start');
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map(), errors = [];
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const current = ++id; pending.set(current, { resolve, reject });
    socket.send(JSON.stringify({ id: current, method, params }));
  });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    }
  };
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const act = expression => evaluate('(()=>{' + expression + ';return true;})()');
  const waitFor = async expression => {
    for (let i = 0; i < 75; i++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Timed out: ' + expression);
  };
  const assert = (condition, reason) => { if (!condition) throw new Error(reason); };
  const screenshot = async name => {
    const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(directory, name + '.png'), Buffer.from(result.data, 'base64'));
  };
  await call('Page.enable'); await call('Runtime.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    // Expose the map only in this QA browser, without modifying production code.
    let leaflet;
    Object.defineProperty(window, 'L', {configurable:true,get(){return leaflet;},set(value){
      leaflet=value;const original=value.map;value.map=function(...args){const map=original.apply(this,args);if(args[0]==='live-map')window.__qaMap=map;return map;};
    }});
    Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(success){
      setTimeout(()=>success({coords:{latitude:25.0389,longitude:102.7183,accuracy:10}}),10);
    }}});
    document.addEventListener('field-location-selected',event=>{window.__selected=event.detail;window.__selections=(window.__selections||0)+1;});
  ` });
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: 'http://127.0.0.1:8000/map/?guest_entry=1#map' });
  await waitFor(`window.__qaMap && document.getElementById('map-status').textContent.includes('Your device is outside')`);
  assert(await evaluate(`__qaMap.getCenter().lat<29&&__qaMap.getCenter().lng>90`), 'Outside device location recentered map');
  assert(await evaluate(`!window.__selections`), 'Outside device location selected a field');
  await act(`document.getElementById('show-region').click()`);
  await waitFor(`!__qaMap._animatingZoom`);
  await new Promise(resolve => setTimeout(resolve, 800));
  await screenshot('region-desktop');

  const accepted = [[18,102.6],[13.7563,100.5018],[16.8409,96.1735],[11.5564,104.9282],[21.0285,105.8542]];
  for (const [lat, lon] of accepted) {
    await act(`document.querySelector('[data-dialog=location-dialog]').click();document.getElementById('manual-latitude').value=${lat};document.getElementById('manual-longitude').value=${lon};document.getElementById('coordinate-form').requestSubmit()`);
    assert(await evaluate(`!document.getElementById('location-dialog').open&&__selected.latitude===${lat}&&__selected.longitude===${lon}`), 'Valid country was rejected');
  }
  const before = await evaluate(`__selections`);
  for (const [lat, lon] of [[25.0389,102.7183],[5.4141,100.3288],[15,93],[15,109.5],[0,0]]) {
    await act(`document.querySelector('[data-dialog=location-dialog]').click();document.getElementById('manual-latitude').value=${lat};document.getElementById('manual-longitude').value=${lon};document.getElementById('coordinate-form').requestSubmit()`);
    assert(await act(`document.getElementById('location-dialog').open&&!document.getElementById('coordinate-error').hidden&&__selections===${before}`), 'Invalid manual coordinate was accepted');
    await act(`document.getElementById('location-dialog').close()`);
    await act(`__qaMap.fire('click',{latlng:L.latLng(${lat},${lon})})`);
    assert(await evaluate(`__selections===${before}`), 'Invalid map click changed the selection');
  }
  assert(await evaluate(`(()=>{let pin;__qaMap.eachLayer(layer=>{if(layer instanceof L.Marker&&layer.options.draggable)pin=layer;});const before=pin.getLatLng();pin.setLatLng([25.0389,102.7183]).fire('dragend');return pin.getLatLng().equals(before)&&__selections===${before};})()`), 'Invalid drag did not restore the last valid pin');
  await act(`__qaMap.setZoom(0,{animate:false});__qaMap.panTo([-33,-70],{animate:false})`);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert(await evaluate(`__qaMap.getZoom()>=__qaMap.getMinZoom()&&__qaMap.getCenter().lat>5&&__qaMap.getCenter().lng>90`), 'Pan/zoom escaped region bounds');

  // A forged POST must also fail server validation, with the saved pin unchanged.
  const serverRejected = await evaluate(`(async()=>{
    const before=await(await fetch('/api/dashboard/')).json();
    const response=await fetch('/',{method:'POST',headers:{'X-CSRFToken':document.querySelector('[name=csrfmiddlewaretoken]').value},body:new URLSearchParams({action:'location',latitude:'25.0389',longitude:'102.7183'})});
    const after=await(await fetch('/api/dashboard/')).json();
    return response.status===400&&JSON.stringify(before.field)===JSON.stringify(after.field);
  })()`);
  assert(serverRejected, 'Server accepted outside pin or changed field');

  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await act(`document.getElementById('show-region').click();document.getElementById('language-toggle').click();document.querySelector('[data-language=lo]').click()`);
  await new Promise(resolve => setTimeout(resolve, 900));
  assert(await act(`document.documentElement.scrollWidth<=innerWidth&&document.getElementById('show-region').getBoundingClientRect().height>=44&&document.getElementById('show-region').textContent.includes('ເບິ່ງ')`), 'Mobile region control or Lao translation failed');
  await screenshot('region-mobile-lao');
  assert(errors.length === 0, 'Browser errors: ' + errors.join(', '));
  console.log(JSON.stringify({ acceptedCountries: accepted.length, rejectedManualAndMapPins: 5, invalidDragRestored: true,
    outsideGeolocationRejected: true, panZoomLimited: true, serverRejectedOutsidePin: true, databaseUnchanged: true,
    mobileLao: true, screenshots: directory }));
} finally {
  socket?.close(); chrome.kill();
}
