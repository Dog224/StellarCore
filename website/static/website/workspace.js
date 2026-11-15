/* Full-page navigation and source-backed, pin-specific condition summaries. */
(() => {
  const page=document.body.dataset.workspace,config=JSON.parse(document.getElementById('map-config').textContent);
  const byId=id=>document.getElementById(id),hasPin=config.latitude!==null&&config.longitude!==null;
  const t=()=>window.TerraGrowI18n?.refresh(document.querySelector('.workspace-main'));
  const fmt=(v,unit='')=>Number.isFinite(v)?new Intl.NumberFormat(document.documentElement.lang,{maximumFractionDigits:1}).format(v)+unit:'—';
  if(page==='crops'||page==='nasa'){
    document.addEventListener('DOMContentLoaded',()=>document.dispatchEvent(new CustomEvent('field-results-opened',{detail:{tab:page==='crops'?'crops':'weather'}})),{once:true});
  }
  if(page==='market'){
    document.addEventListener('DOMContentLoaded',()=>document.dispatchEvent(new CustomEvent('market-page-ready')),{once:true});
    byId('income-form').addEventListener('submit',event=>{
      event.preventDefault();const quantity=Number(byId('income-quantity').value),price=Number(byId('income-price').value),costText=byId('income-costs').value,cost=Number(costText),code=byId('income-currency').value;
      if(![quantity,price,cost].every(Number.isFinite))return;
      const result=byId('income-result');result.replaceChildren();
      const line=(label,value)=>{const p=document.createElement('p'),span=document.createElement('span'),strong=document.createElement('strong');span.textContent=label;strong.textContent=' '+new Intl.NumberFormat(document.documentElement.lang,{maximumFractionDigits:code==='LAK'?0:2}).format(value)+' '+code;strong.dataset.noTranslate='';p.append(span,strong);result.append(p);};
      line('Estimated gross revenue:',quantity*price);if(costText)line('Revenue after entered costs:',quantity*price-cost);t();
    });
  }
  if(page==='nasa'){
    const svg=(tag,attributes)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attributes).forEach(([key,value])=>node.setAttribute(key,value));return node;};
    let report;
    function mini(id,key,unit){
      const root=byId(id);root.replaceChildren();
      const values=report.days.map(day=>day[key]),valid=values.filter(Number.isFinite);
      if(!valid.length){const p=document.createElement('p');p.textContent='Unavailable';root.append(p);return;}
      const min=key==='rainfall_mm'?0:Math.min(...valid),max=Math.max(...valid),span=max-min||1;
      const chart=svg('svg',{viewBox:'0 0 300 115',role:'img','aria-label':key+' historical observations'});
      const y=value=>90-65*(value-min)/span,x=index=>12+276*index/Math.max(1,values.length-1);
      const base=svg('line',{x1:12,x2:288,y1:91,y2:91,class:'nasa-mini-gridline'});chart.append(base);
      let path='';values.forEach((value,index)=>{
        if(!Number.isFinite(value)){path+=' ';return;}
        if(key==='rainfall_mm')chart.append(svg('line',{x1:x(index),x2:x(index),y1:90,y2:y(value),class:'nasa-mini-rain'}));
        else path+=(index===0||!Number.isFinite(values[index-1])?'M':'L')+x(index).toFixed(2)+','+y(value).toFixed(2)+' ';
      });
      if(key!=='rainfall_mm')chart.append(svg('path',{d:path,class:'nasa-mini-line'}));
      for(const [date,xValue,anchor] of [[report.days[0].date,12,'start'],[report.days.at(-1).date,288,'end']]){
        const tick=svg('text',{x:xValue,y:109,'text-anchor':anchor,class:'nasa-mini-label'});tick.textContent=date;tick.dataset.noTranslate='';chart.append(tick);
      }
      const label=svg('text',{x:12,y:15,class:'nasa-mini-label'});label.textContent=fmt(min)+' – '+fmt(max)+' '+unit;chart.append(label);root.append(chart);
    }
    function overview(data){
      report=data;const s=data.summary;
      byId('nasa-temperature').textContent=fmt(s.temperature_c,' °C');byId('nasa-rain').textContent=fmt(s.observed_rainfall_mm,' mm');
      byId('nasa-humidity').textContent=fmt(s.humidity_percent,' %');
      const soil=data.days.findLast(day=>Number.isFinite(day.soil_surface));
      byId('nasa-soil').textContent=fmt(soil?.soil_surface,data.soil.kind==='volumetric'?' m³/m³':' / 1');byId('nasa-soil-date').textContent=soil?soil.date+' (UTC)':'';
      const period=byId('nasa-overview-period');period.dataset.noTranslate='';period.textContent=`NASA POWER · ${data.requested_start} – ${data.requested_end} (UTC) · ${data.summary.rain_valid_days} valid rain days / ${data.days.length}`;
      mini('nasa-temperature-chart','temperature_c','°C');mini('nasa-rain-chart','rainfall_mm','mm/day');mini('nasa-wind-chart','wind_ms','m/s · 2 m');t();
    }
    document.addEventListener('weather-history-loaded',event=>overview(event.detail));
    const status=byId('history-status');
    new MutationObserver(()=>{
      if(!report&&byId('weather-history').getAttribute('aria-busy')==='false'){byId('nasa-overview-period').textContent=status.textContent;t();}
    }).observe(status,{childList:true,subtree:true});
    document.addEventListener('terragrow-language-changed',()=>{if(report)overview(report);});
  }
  if(page==='alerts'){
    let data={},active='dry',map,marker;
    const definitions={
      dry:{title:'Dry conditions',explanation:'Days with less than 1 mm of modelled rain in the previous seven complete UTC days. This describes recent dryness; it is not a drought probability.',url:'https://open-meteo.com/en/docs',source:'Open-Meteo weather'},
      flood:{title:'Flood watch',explanation:'Not assessed. A river-gauge or flood-inundation feed is not connected. Rainfall alone cannot identify flooding at your farm.',url:'https://www.mrcmekong.org/',source:'Mekong River Commission'},
      heat:{title:'Heat conditions',explanation:'Modelled air temperature near your saved pin. A single reading is not an extreme-heat warning or a crop-specific heat assessment.',url:'https://open-meteo.com/en/docs',source:'Open-Meteo weather'},
      rain:{title:'Rainfall',explanation:'Total modelled rainfall over the previous seven complete UTC days. This is past rain, not a forecast of when it will rain.',url:'https://open-meteo.com/en/docs',source:'Open-Meteo weather'},
      stress:{title:'Crop stress',explanation:'Not assessed. Clear satellite observations, a processing connection and crop-specific interpretation are needed. Greenness alone does not diagnose disease or soil fertility.',url:'https://dataspace.copernicus.eu/',source:'Copernicus Sentinel-2'},
      air:{title:'Air quality · PM2.5',explanation:'Regional CAMS model estimate, approximately 45 km per grid cell. This is not a sensor reading at your field.',url:'https://open-meteo.com/en/docs/air-quality-api',source:'Open-Meteo / CAMS'}
    };
    const valid=part=>['ok','stale'].includes(part?.status);
    function reading(key){
      if(key==='dry')return data.rain?.status==='ok'?fmt(data.rain.dry_days,' / 7 days'):'—';
      if(key==='rain')return data.rain?.status==='ok'?fmt(data.rain.rainfall_mm,' mm'):'—';
      if(key==='heat')return valid(data.weather)?fmt(data.weather.temperature_c,' °C'):'—';
      if(key==='air')return valid(data.air)?fmt(data.air.pm25,' µg/m³'):'—';
      return 'Not assessed';
    }
    function render(){
      document.querySelectorAll('[data-condition-value]').forEach(node=>{node.textContent=reading(node.dataset.conditionValue);if(!['flood','stress'].includes(node.dataset.conditionValue))node.dataset.noTranslate='';});
      const definition=definitions[active];byId('condition-title').textContent=definition.title;byId('condition-reading').textContent=reading(active);byId('condition-reading').toggleAttribute('data-no-translate',!['flood','stress'].includes(active));
      byId('condition-explanation').textContent=definition.explanation;
      const part=['dry','rain'].includes(active)?data.rain:active==='heat'?data.weather:active==='air'?data.air:null;
      const date=part?.status==='ok'||part?.status==='stale'?(part.time||`${part.period_start} – ${part.period_end} (UTC)`):'';
      byId('condition-date').textContent=date+(part?.status==='stale'?' · Older model estimate':'');
      const a=document.createElement('a');a.textContent=definition.source;a.href=definition.url;a.target='_blank';a.rel='noopener';byId('condition-sources').replaceChildren(a);
      document.querySelectorAll('[data-condition]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.condition===active)));
      if(marker){marker.getElement()?.classList.toggle('is-missing',reading(active)==='—'||['flood','stress'].includes(active));marker.bindPopup(document.createTextNode(`${definition.title}: ${reading(active)}`));}
      t();
    }
    async function load(refresh=false){
      data={};render();const status=byId('workspace-data-status'),button=byId('alerts-refresh');
      if(!hasPin){status.textContent='Choose a field on the home map to load local conditions.';t();return;}
      status.textContent='Loading conditions for your saved field...';button.disabled=true;t();
      try{
        const response=await fetch('/api/home/conditions/'+(refresh?'?refresh=1':''),{cache:'no-store',signal:AbortSignal.timeout(30000)});
        const result=await response.json();
        if(!response.ok||Number(result.latitude)!==Number(config.latitude)||Number(result.longitude)!==Number(config.longitude))throw new Error('Pin changed');
        data=result;status.textContent=result.status==='ok'?'Conditions follow your saved pin.':'Some conditions are unavailable. Missing readings stay blank.';
      }catch{status.textContent='Conditions are unavailable. Try again or explore the historical records.';}
      finally{button.disabled=false;render();}
    }
    document.querySelectorAll('[data-condition]').forEach(button=>button.addEventListener('click',()=>{
      active=button.dataset.condition;render();const detail=document.querySelector('.mekong-condition-detail');detail.classList.remove('condition-enter');requestAnimationFrame(()=>detail.classList.add('condition-enter'));
    }));
    byId('alerts-refresh').addEventListener('click',()=>load(true));
    if(window.L){
      map=L.map('mekong-alert-map',{scrollWheelZoom:false}).setView(hasPin?[config.latitude,config.longitude]:[16,103],hasPin?7:5);
      // Use the same imagery service as the home map. Keep a local vector map
      // underneath it, so a provider failure never replaces the map with errors.
      const region=JSON.parse(byId('map-region').textContent);
      const borders=L.geoJSON(region,{style:{color:'#f0f3df',weight:1.3,fillOpacity:0},interactive:false}).addTo(map);
      map.attributionControl.addAttribution('Boundaries: <a href="https://www.naturalearthdata.com/">Natural Earth</a>');
      const mapStatus=document.createElement('div'),mapMessage=document.createElement('span'),retry=document.createElement('button');
      mapStatus.className='mekong-map-status';mapMessage.setAttribute('role','status');
      retry.type='button';retry.className='mekong-map-retry';retry.textContent='Retry map images';retry.hidden=true;
      mapStatus.append(mapMessage,retry);map.getContainer().after(mapStatus);
      let imagery,tileDeadline;
      function mapState(state,message){
        map.getContainer().dataset.imagery=state;mapMessage.textContent=message;retry.hidden=state!=='unavailable';t();
      }
      function fallback(layer){
        if(imagery!==layer)return;
        clearTimeout(tileDeadline);imagery=null;
        // Detach handlers before removing pending tiles. No automatic retry or
        // alternate OSM endpoint: an explicit retry makes one new attempt.
        layer.off('loading tileerror load');map.removeLayer(layer);
        borders.setStyle({color:'#54836b',weight:1.3,fillOpacity:.12});
        borders.eachLayer(country=>country.bindTooltip(country.feature.properties.name,{permanent:true,direction:'center',className:'mekong-country-label'}));
        mapState('unavailable','Map images are unavailable. Country boundaries and your saved pin are still shown.');
      }
      function loadImagery(){
        if(imagery)return;
        borders.eachLayer(country=>country.unbindTooltip());borders.setStyle({color:'#f0f3df',weight:1.3,fillOpacity:0});
        mapState('loading','Loading map images...');
        const layer=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{
          maxZoom:19,updateWhenIdle:true,keepBuffer:1,
          attribution:'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community'
        });
        imagery=layer;
        const deadline=()=>{clearTimeout(tileDeadline);tileDeadline=setTimeout(()=>fallback(layer),15000);};
        layer.on('loading',deadline);
        layer.on('tileerror',()=>fallback(layer));
        layer.on('load',()=>{
          if(imagery!==layer)return;
          clearTimeout(tileDeadline);
          mapState('ready','Satellite imagery: Esri. Images may be older than current field conditions.');
        });
        deadline();layer.addTo(map);
      }
      retry.addEventListener('click',loadImagery);loadImagery();
      if(hasPin)marker=L.marker([config.latitude,config.longitude],{icon:L.divIcon({className:'mekong-pin',iconSize:[24,24],iconAnchor:[12,12]})}).addTo(map);
      document.addEventListener('mekongrise-theme-changed',()=>map.invalidateSize());
    }
    document.addEventListener('terragrow-language-changed',render);load();
  }
})();
