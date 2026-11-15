/* Home cards use a small current-model request; NASA history stays lazy. */
(() => {
  const root = document.getElementById('home-conditions');
  if (!root) return;
  const byId = id => document.getElementById(id);
  const config = JSON.parse(byId('map-config').textContent);
  let controller, sequence = 0;
  const localize = () => { window.TerraGrowI18n?.refresh(document.querySelector('.home-side-column')); window.TerraGrowI18n?.refresh(byId('alerts-dialog')); };
  const display = (value, digits=1) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
  const stamp = value => value ? value.replace('T', ' ').replace('Z', '') + ' UTC' : '';
  const weatherDescription = code => code === 0 ? 'Clear sky' : code >= 1 && code <= 3 ? 'Cloudy' :
    code >= 45 && code <= 48 ? 'Fog' : code >= 51 && code <= 57 ? 'Drizzle' : code >= 61 && code <= 67 ? 'Rain' :
    code >= 71 && code <= 77 ? 'Snow' : code >= 80 && code <= 86 ? 'Showers' : code >= 95 ? 'Thunderstorms' : 'Modelled weather';
  function clear(message) {
    ['home-temperature','home-wind','home-humidity','home-dry-days','home-pm25','alerts-rain','alerts-air'].forEach(id => byId(id).textContent='—');
    ['home-weather-time','alerts-rain-period','alerts-air-time','alerts-air-level'].forEach(id => byId(id).textContent='');
    byId('home-weather-description').textContent=message;
    byId('home-air-level').textContent='Not checked';
    byId('home-wind-label').textContent='Wind (10 m)';
    byId('home-dry-period').textContent='In the last 7 days';
    byId('home-weather-source').textContent='Open-Meteo';byId('home-weather-source').href='https://open-meteo.com/';
    byId('home-conditions-status').textContent=message;
    document.querySelectorAll('.home-risk-item').forEach(node=>delete node.dataset.level);
    byId('alerts-pin').textContent=config.latitude !== null && config.longitude !== null ? `${Number(config.latitude).toFixed(5)}, ${Number(config.longitude).toFixed(5)}` : '';
    localize();
  }
  async function nasaFallback(current, signal, missingWeather, missingRain) {
    if(missingWeather){byId('home-weather-description').textContent='Trying NASA historical weather...';localize();}
    const response=await fetch('/api/weather/',{signal,cache:'no-store'});
    if(!response.ok)return;
    const data=await response.json();
    if(current!==sequence || data.status!=='ok' || Number(data.latitude).toFixed(4)!==Number(config.latitude).toFixed(4) || Number(data.longitude).toFixed(4)!==Number(config.longitude).toFixed(4))return;
    const age=(Date.now()-Date.parse(data.period_end+'T00:00:00Z'))/86400000;
    if(!Number.isFinite(age)||age<0)return;
    if(missingWeather){
      byId('home-temperature').textContent=display(data.temperature_c)+' °C';
      byId('home-wind').textContent=display(typeof data.wind_ms==='number'?data.wind_ms*3.6:null)+' km/h';
      byId('home-humidity').textContent=display(data.humidity_percent,0)+'%';
      byId('home-weather-description').textContent=age>14?'Older weekly summary':'Recent 7-day average';
      byId('home-wind-label').textContent='Wind (2 m)';
      byId('home-weather-time').textContent=`${data.period_start} – ${data.period_end} UTC`;
      byId('home-weather-source').textContent='NASA POWER';byId('home-weather-source').href='https://power.larc.nasa.gov/';
      byId('home-conditions-status').textContent='Showing a dated NASA summary. Current weather is unavailable.';
    }
    if(missingRain){
      const days=data.days||[];
      const valid=days.length===7&&days.every((day,index)=>Number.isFinite(day.rainfall_mm)&&day.rainfall_mm>=0&&Date.parse(day.date+'T00:00:00Z')===Date.parse(data.period_start+'T00:00:00Z')+index*86400000);
      if(valid&&days.at(-1).date===data.period_end){
        byId('home-dry-days').textContent=`${days.filter(day=>day.rainfall_mm<1).length}/7`;
        byId('home-dry-period').textContent='In the latest available week';
        byId('alerts-rain').textContent=display(days.reduce((sum,day)=>sum+day.rainfall_mm,0))+' mm / 7 days';
        byId('alerts-rain-period').textContent=`${data.period_start} – ${data.period_end} (UTC) · NASA POWER`;
      }
    }
    localize();
    return true;
  }
  async function load(refresh=false) {
    const current=++sequence;
    controller?.abort();
    const requestController=new AbortController();controller=requestController;
    if (config.latitude===null || config.longitude===null) { clear('Save a pin to see local conditions.'); root.setAttribute('aria-busy','false');byId('home-weather-retry').disabled=true;return; }
    clear('Loading local conditions...');root.setAttribute('aria-busy','true');byId('home-weather-retry').disabled=true;
    const timeout=setTimeout(()=>requestController.abort(),38000);
    try {
      const response=await fetch('/api/home/conditions/'+(refresh?'?refresh=1':''),{signal:requestController.signal,cache:'no-store'});
      const data=await response.json();
      if(current!==sequence)return;
      if(!response.ok || Number(data.latitude)!==Number(config.latitude) || Number(data.longitude)!==Number(config.longitude))throw new Error('Pin changed');
      const weather=data.weather || {}, rain=data.rain || {}, air=data.air || {};
      if(['ok','stale'].includes(weather.status)) {
        byId('home-temperature').textContent=display(weather.temperature_c)+' °C';
        byId('home-wind').textContent=display(weather.wind_kmh)+' km/h';
        byId('home-humidity').textContent=display(weather.humidity_percent,0)+'%';
        byId('home-weather-description').textContent=weather.status==='stale'?'Older model estimate':weatherDescription(weather.code);
        byId('home-weather-time').textContent=stamp(weather.time);
      } else byId('home-weather-description').textContent='Weather unavailable';
      if(rain.status==='ok') {
        byId('home-dry-days').textContent=`${rain.dry_days}/7`;
        byId('alerts-rain').textContent=display(rain.rainfall_mm)+' mm / 7 days';
        byId('alerts-rain-period').textContent=`${rain.period_start} – ${rain.period_end} (UTC)`;
      }
      if(['ok','stale'].includes(air.status)) {
        byId('home-pm25').textContent=display(air.pm25);
        byId('home-air-level').textContent=air.status==='stale'?'Older model estimate':air.level || 'Unavailable';
        byId('alerts-air').textContent=`PM2.5 ${display(air.pm25)} µg/m³ · US AQI ${display(air.aqi,0)}`;
        byId('alerts-air-level').textContent=air.status==='stale'?'Older model estimate':air.level || 'Unavailable';
        byId('alerts-air-time').textContent=stamp(air.time);
        if(air.status==='ok'&&air.aqi>100)byId('home-pm25').closest('.home-risk-item').dataset.level='high';
      } else byId('home-air-level').textContent='Unavailable';
      byId('home-conditions-status').textContent=data.status==='ok'?'Conditions follow your saved pin.':'Some conditions are unavailable. Missing readings stay blank.';
      localize();
      if(!['ok','stale'].includes(weather.status)||rain.status!=='ok'){
        let fallback=false;
        try{fallback=await nasaFallback(current,requestController.signal,!['ok','stale'].includes(weather.status),rain.status!=='ok');}
        catch { /* Keep any independently successful air/current readings. */ }
        if(current===sequence&&!fallback&&!['ok','stale'].includes(weather.status))byId('home-weather-description').textContent='Weather unavailable';
      }
    } catch(error) {
      if(current===sequence)clear('Conditions unavailable. Open NASA data for historical records.');
    } finally {
      clearTimeout(timeout);
      if(current===sequence){root.setAttribute('aria-busy','false');byId('home-weather-retry').disabled=false;localize();}
    }
  }
  document.addEventListener('field-location-selected',event=>{
    ++sequence;controller?.abort();Object.assign(config,event.detail);clear('View results to save this pin and load conditions.');root.setAttribute('aria-busy','false');byId('home-weather-retry').disabled=true;
  });
  document.addEventListener('field-location-saved',event=>{Object.assign(config,event.detail);load();});
  byId('home-weather-retry').addEventListener('click',()=>load(true));
  document.querySelectorAll('[data-home-results]').forEach(button=>button.addEventListener('click',()=>{
    document.dispatchEvent(new CustomEvent('field-results-request',{detail:{tab:button.dataset.homeResults}}));
  }));
  // Dialog buttons in the rail share the same active-state treatment as links.
  document.querySelectorAll('.home-sidebar nav button').forEach(button=>button.addEventListener('click',()=>{
    document.querySelectorAll('.home-sidebar nav a,.home-sidebar nav button').forEach(node=>{
      node.classList.toggle('active',node===button);node.removeAttribute('aria-current');
    });
  }));
  document.querySelectorAll('.home-sidebar nav a').forEach(link=>link.addEventListener('click',()=>{
    document.querySelectorAll('.home-sidebar nav button').forEach(button=>button.classList.remove('active'));
    document.querySelectorAll('.home-sidebar nav a').forEach(node=>{if(node===link)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});
  }));
  ['alerts-dialog','market-dialog','help-dialog'].forEach(id=>byId(id).addEventListener('close',()=>{
    document.querySelectorAll('.home-sidebar nav button').forEach(button=>button.classList.remove('active'));
    document.querySelectorAll('.home-sidebar nav a').forEach(link=>{
      const home=link.getAttribute('href')==='/map/';
      link.classList.toggle('active',home);
      if(home)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
    });
  }));
  if(config.latitude!==null && config.longitude!==null)load();else clear('Save a pin to see local conditions.');
})();
