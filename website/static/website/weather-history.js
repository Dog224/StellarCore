/* Descriptive, source-backed history. No generated readings or forecast claims. */
(() => {
  const root = document.getElementById('weather-history');
  if (!root) return;
  const byId = id => document.getElementById(id);
  const content = byId('history-content'), status = byId('history-status');
  const config = JSON.parse(byId('map-config').textContent);
  const slider = byId('history-date-slider');
  let period = '100d', variable = 'rain', report, controller, sequence = 0;
  let started = false, unsaved = false, dirty = true, loading = false, shownDays = 0, points = [], chartWidth = 0;
  const savedReports = new Map();
  const locale = () => ({lo:'lo-LA', th:'th-TH', en:'en-GB'}[document.documentElement.lang] || 'en-GB');
  const localize = node => window.TerraGrowI18n?.refresh(node || root);
  const number = (value, digits = 1) => value === null || value === undefined ? '—' :
    new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(value);
  const laoMonths = ['ມ.ກ.','ກ.ພ.','ມີ.ນ.','ເມ.ສ.','ພ.ພ.','ມິ.ຖ.','ກ.ລ.','ສ.ຫ.','ກ.ຍ.','ຕ.ລ.','ພ.ຈ.','ທ.ວ.'];
  const date = value => {
    if(!value)return '—';
    const day=new Date(value+'T00:00:00Z');
    return document.documentElement.lang==='lo'?`${day.getUTCDate()} ${laoMonths[day.getUTCMonth()]} ${day.getUTCFullYear()}`:
      day.toLocaleDateString(locale(), {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  };
  const monthYear = value => {
    const day=new Date(value+'T00:00:00Z');
    return document.documentElement.lang==='lo'?`${laoMonths[day.getUTCMonth()]} ${day.getUTCFullYear()}`:
      day.toLocaleDateString(locale(),{month:'short',year:'numeric',timeZone:'UTC'});
  };
  const make = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const tokens = (...items) => { const node = make('span'); items.forEach((text, index) => { if(index)node.append(' '); node.append(make('span', text)); }); return node; };
  const coverageText = key => `${report.coverage[key].valid_days} / ${report.coverage[key].expected_days}`;
  const soilUnit = () => report.soil.kind === 'volumetric' ? 'm³/m³' : '/ 1';
  function clear() {
    report = null; content.hidden = true; byId('history-days').replaceChildren();
    byId('history-chart').replaceChildren(); byId('history-metrics').replaceChildren();
    byId('history-patterns').replaceChildren(); byId('history-warning').hidden = true;
    byId('history-pin').textContent = ''; shownDays = 0;
  }
  function metric(label, value, note, key) {
    const node = make('article', undefined, 'history-metric history-metric-' + key);
    node.append(make('p', label), make('strong', value), make('small', note));
    byId('history-metrics').append(node);
  }
  function pattern(label, value, note) {
    const node = make('article'); node.append(make('h4', label), make('strong', value));
    if (note) node.append(typeof note === 'string' ? make('p', note) : note);
    byId('history-patterns').append(node);
  }
  function renderMetrics() {
    const summary = report.summary;
    byId('history-metrics').replaceChildren();
    metric('Observed rainfall', number(summary.observed_rainfall_mm) + ' mm', coverageText('rainfall_mm'), 'rain');
    metric('Average temperature', number(summary.temperature_c) + ' °C', coverageText('temperature_c'), 'temperature');
    metric('Average wind (2 m)', number(summary.wind_ms, 2) + ' m/s', coverageText('wind_ms'), 'wind');
    const soil = report.days.findLast(row=>row.soil_surface!==null);
    metric('Latest surface soil moisture', number(soil?.soil_surface, 3) + ' ' + soilUnit(), soil ? date(soil.date) : 'Unavailable', 'soil');
    byId('history-soil-label').textContent=report.soil.kind==='volumetric'?'Modelled soil water content is shown in m³/m³. This does not measure soil fertility.':'Model soil wetness: 0 means dry and 1 means saturated. This does not measure soil fertility.';
    root.querySelectorAll('.history-metric:not(.history-metric-soil) small').forEach(node => node.append(' ', make('span', 'valid days')));
    byId('history-patterns').replaceChildren();
    pattern('Rainy days (≥ 1 mm)', `${summary.rainy_days} / ${summary.rain_valid_days}`, tokens('Historical frequency', number(summary.rainy_day_frequency_percent) + '%', 'Not a rain forecast'));
    pattern('Longest observed dry spell', number(summary.longest_observed_dry_spell_days, 0), 'Consecutive days below 1 mm. Missing days break the count.');
    pattern('Hottest recorded day', number(summary.hottest_day?.maximum_c) + ' °C', date(summary.hottest_day?.date));
    pattern('Coldest recorded day', number(summary.coldest_day?.minimum_c) + ' °C', date(summary.coldest_day?.date));
    const changes = report.changes;
    const comparison = make('article', undefined, 'history-comparison');
    comparison.append(make('h4', 'Earlier compared with later'), make('p', `${date(changes.earlier_start)} – ${date(changes.earlier_end)} → ${date(changes.later_start)} – ${date(changes.later_end)}`));
    const differences = make('div');
    for (const [key, label, unit] of [['rainfall_mm','Rainfall','mm'],['temperature_c','Temperature','°C'],['wind_ms','Wind speed','m/s']]) {
      const value = changes[key];
      differences.append(tokens(label, (value > 0 ? '+' : '') + number(value, key === 'wind_ms' ? 2 : 1), unit));
    }
    comparison.append(differences, make('p', 'Later minus earlier. Differences are hidden when either period has missing readings. This is not a long-term climate trend.'));
    byId('history-patterns').append(comparison);
  }

  const variableInfo = {
    rain: {title:'Rainfall pattern', unit:'mm', lines:[['rainfall_mm','Rainfall','#438bb1']]},
    temperature: {title:'Temperature pattern', unit:'°C', lines:[['minimum_c','Daily low','#4d8eab'],['temperature_c','Daily average','#297052'],['maximum_c','Daily high','#c27749']]},
    wind: {title:'Wind speed pattern', unit:'m/s', lines:[['wind_ms','Mean wind at 2 m','#648a9b']]},
    soil: {title:'Soil moisture pattern', lines:[['soil_surface','Surface soil','#8c7645'],['soil_root','Root zone','#3d8067']]},
  };
  function svgNode(tag, attributes = {}, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([name,value]) => node.setAttribute(name, value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function setReading(index) {
    if (!report || !points.length) return;
    index = Math.max(0, Math.min(points.length - 1, index));
    slider.value = index;
    const point = points[index], info = variableInfo[variable];
    const long=period==='5y'||period==='10y';
    const output = byId('history-chart-reading'); output.replaceChildren(make('strong', long?monthYear(point.date):date(point.date)));
    for (const [key,label] of info.lines) output.append(tokens(seriesLabel(key,label), number(point[key], variable === 'soil' ? 3 : 2), variable === 'soil' ? soilUnit() : info.unit));
    if (point.rain_valid_days !== undefined) output.append(tokens('Rain data coverage', `${point.rain_valid_days} / ${point.days}`));
    const cursor = byId('history-chart').querySelector('.history-cursor');
    if (cursor) { const x = 45 + index / Math.max(1, points.length - 1) * (chartWidth - 62); cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); }
    localize(output);
    slider.setAttribute('aria-valuetext', output.textContent);
  }
  function seriesLabel(key,label) {
    if(period==='5y'||period==='10y')return {maximum_c:'Mean daily high',minimum_c:'Mean daily low',temperature_c:'Mean temperature'}[key]||label;
    return label;
  }
  function renderChart() {
    if (!report || content.hidden) return;
    const host = byId('history-chart');
    chartWidth = Math.max(280, Math.round(host.getBoundingClientRect().width || 700));
    const long = period === '5y' || period === '10y';
    points = long ? report.months : report.days;
    const info = variableInfo[variable], unit = variable === 'soil' ? soilUnit() : info.unit;
    byId('history-chart-title').textContent = info.title;
    byId('history-chart-unit').textContent = unit;
    byId('history-chart-note').textContent = long ? 'Monthly rainfall totals; temperature, wind and soil are monthly means. Gaps mean missing data.' : 'Daily records. Gaps mean missing data, not zero. Move the date slider to read a value.';
    const legend = byId('history-chart-legend'); legend.replaceChildren();
    for (const [key, label, color] of info.lines) { const item = make('span', seriesLabel(key,label)); item.style.setProperty('--series-color', color); legend.append(item); }
    if(points.some(point=>info.lines.some(([key])=>point[key]===null))){const item=make('span','Missing reading');item.style.setProperty('--series-color','#9b7b72');legend.append(item);}
    const values = points.flatMap(point => info.lines.map(([key]) => point[key])).filter(value => value !== null && value !== undefined);
    host.replaceChildren();
    if (!values.length) { host.append(make('p', 'No valid readings for this measurement in the selected period.', 'history-no-chart')); slider.disabled = true; byId('history-chart-reading').replaceChildren(); localize(root); return; }
    slider.disabled = false;
    let low = variable === 'temperature' ? Math.floor(Math.min(...values) - 2) : 0;
    let high = variable === 'soil' ? 1 : Math.max(...values) * 1.12;
    if (high <= low) high = low + 1;
    const x = index => 45 + index / Math.max(1, points.length - 1) * (chartWidth - 62);
    const y = value => 205 - (value - low) / (high - low) * 185;
    const svg = svgNode('svg', {viewBox:`0 0 ${chartWidth} 250`, role:'img', 'aria-labelledby':'history-svg-title history-svg-desc'});
    svg.append(svgNode('title', {id:'history-svg-title'}, info.title), svgNode('desc', {id:'history-svg-desc'}, 'Regional historical estimates. Use the date slider or daily readings table for exact values.'));
    for (let step = 0; step <= 4; step++) {
      const value = low + (high - low) * step / 4, position = y(value);
      svg.append(svgNode('line', {x1:45,y1:position,x2:chartWidth-17,y2:position,stroke:'#e1e7dc'}), svgNode('text', {x:38,y:position+4,'text-anchor':'end',class:'history-axis'}, number(value, variable === 'soil' ? 2 : 1)));
    }
    if (variable === 'rain') {
      const width = Math.max(.6, Math.min(15, (chartWidth - 62) / points.length * .75));
      points.forEach((point,index) => {
        if (point.rainfall_mm === null) {svg.append(svgNode('rect',{x:x(index)-width/2,y:209,width,height:3,fill:'#9b7b72'}));return;}
        const height=Math.max(1,205-y(point.rainfall_mm));
        const bar = svgNode('rect', {x:x(index)-width/2,y:205-height,width,height,fill:'#438bb1',rx:1});
        bar.append(svgNode('title',{},`${point.date}: ${point.rainfall_mm} mm`)); svg.append(bar);
      });
    } else {
      for (const [key,,color] of info.lines) {
        let path = '', connected = false;
        points.forEach((point,index) => { if(point[key]===null || point[key]===undefined){connected=false;return;} path += `${connected?'L':'M'}${x(index).toFixed(2)},${y(point[key]).toFixed(2)} `;connected=true; });
        svg.append(svgNode('path',{d:path,fill:'none',stroke:color,'stroke-width':2.3,'stroke-linejoin':'round','stroke-linecap':'round'}));
      }
    }
    for (let index=0; index<4; index++) {
      const pointIndex = Math.round((points.length-1)*index/3), point = points[pointIndex];
      const day = new Date(point.date+'T00:00:00Z');
      const label = document.documentElement.lang==='lo'?(long?`${laoMonths[day.getUTCMonth()]} ${String(day.getUTCFullYear()).slice(-2)}`:`${day.getUTCDate()} ${laoMonths[day.getUTCMonth()]}`):day.toLocaleDateString(locale(), long ? {month:'short',year:'2-digit',timeZone:'UTC'} : {day:'numeric',month:'short',timeZone:'UTC'});
      svg.append(svgNode('text',{x:x(pointIndex),y:233,'text-anchor':index===0?'start':index===3?'end':'middle',class:'history-axis'},label));
    }
    svg.append(svgNode('line', {class:'history-cursor',x1:45,x2:45,y1:15,y2:207,stroke:'#183f32','stroke-dasharray':'3 4','stroke-width':1}));
    svg.addEventListener('pointermove', event => {
      const box = svg.getBoundingClientRect(), pixel = (event.clientX - box.left) * chartWidth / box.width;
      setReading(Math.round((pixel-45)/(chartWidth-62)*(points.length-1)));
    });
    host.append(svg); slider.max = Math.max(0, points.length-1);
    setReading(Math.min(Number(slider.value), points.length-1));
    localize(root);
  }
  function renderSeasonality() {
    const host = byId('history-seasonality'); host.replaceChildren();
    if (period !== '5y' && period !== '10y') host.append(make('p','Select 5 or 10 years to compare seasonal patterns.','data-note'));
    else {
      host.append(make('h4','Average monthly rainfall'),make('p','Only complete months with complete rainfall records.','data-note'));
      const bars = make('div',undefined,'history-seasonal-bars');
      const max = Math.max(1,...report.seasonality.map(item=>item.rainfall_mm||0));
      report.seasonality.forEach(item=>{
        const column = make('div');
        const label = document.documentElement.lang==='lo'?laoMonths[item.month-1]:new Date(Date.UTC(2020,item.month-1,1)).toLocaleDateString(locale(),{month:'short',timeZone:'UTC'});
        const bar=make('span',undefined,'history-seasonal-bar'); bar.style.height=(item.rainfall_mm===null?0:item.rainfall_mm/max*90)+'px';
        column.append(make('small',number(item.rainfall_mm,0)),bar,make('span',label),tokens(String(item.years),'years'));
        column.title=label+': '+number(item.rainfall_mm)+' mm'; bars.append(column);
      });
      host.append(bars);
    }
    const body=byId('history-years');body.replaceChildren();
    report.years.filter(item=>item.complete_calendar_year).forEach(item=>{
      const row=make('tr');
      [String(item.year),number(item.rainfall_mm),number(item.temperature_c),number(item.wind_ms,2),`${item.rain_valid_days} / ${item.days}`].forEach(value=>row.append(make('td',value)));
      body.append(row);
    });
    if(!body.children.length){const row=make('tr'),cell=make('td','No complete calendar year in this selection.');cell.colSpan=5;row.append(cell);body.append(row);}
  }
  function showDays() {
    if(!report)return;
    const rows=report.days.slice().reverse().slice(shownDays,shownDays+50);
    for(const item of rows){const row=make('tr');[date(item.date),number(item.rainfall_mm,2),number(item.temperature_c),number(item.maximum_c),number(item.minimum_c),number(item.wind_ms,2),number(item.humidity_percent),number(item.soil_surface,3),number(item.soil_root,3)].forEach(value=>row.append(make('td',value)));byId('history-days').append(row);}
    shownDays+=rows.length;byId('history-more').hidden=shownDays>=report.days.length;localize(byId('history-daily-details'));
  }
  function renderSources() {
    const host=byId('history-sources');host.replaceChildren();
    host.append(tokens('Source','NASA POWER',report.source_products.join(', ')),tokens('Retrieved',new Date(report.fetched_at).toLocaleString(locale())),make('p',`${report.requested_start} – ${report.requested_end} (UTC)`));
    for(const [label,url] of [['Open NASA data request',report.source_url],['NASA methodology',report.documentation_url],['Soil data methodology',report.soil_documentation_url]]){
      const link=make('a',label);link.href=url;link.target='_blank';link.rel='noopener';host.append(link);
    }
    const table=make('table',undefined,'weather-table'),head=make('tr');
    ['Measurement','Valid days','Missing days','Latest reading'].forEach(label=>head.append(make('th',label)));
    const thead=make('thead');thead.append(head);table.append(thead);
    for(const data of Object.values(report.coverage)){const row=make('tr');[data.parameter,`${data.valid_days} / ${data.expected_days}`,String(data.missing_days),date(data.last_date)].forEach(value=>row.append(make('td',value)));table.append(row);}
    const wrap=make('div',undefined,'weather-table-wrap');wrap.append(table);host.append(wrap);
    byId('history-soil-method').textContent=report.soil.kind==='volumetric'?'Soil values are modelled volumetric water content in m³/m³. They do not measure fertility.':'Soil values are a model wetness index from 0 (dry) to 1 (saturated). They are not a percentage of water by soil volume and do not measure fertility.';
  }
  function render() {
    if(!report)return;
    content.hidden=false;
    byId('history-period').textContent=`${date(report.requested_start)} – ${date(report.requested_end)} (UTC)`;
    byId('history-pin').textContent=`${Number(config.latitude).toFixed(5)}, ${Number(config.longitude).toFixed(5)}`;
    byId('history-period-note').textContent=period==='5y'||period==='10y'?'Complete past calendar years. Historical patterns, not a forecast.':'Historical records ending before today. Publication delays can leave gaps.';
    const warning=byId('history-warning');
    const incomplete=Object.values(report.coverage).some(item=>item.missing_days>0);
    warning.hidden=!incomplete&&report.end_gap_days<=7;
    warning.textContent=report.end_gap_days>7?'The returned readings end more than 7 days before the requested end date. Some recent data is unavailable.':incomplete?'Some readings are missing. Coverage is shown below each measurement and in the source details.':' ';
    status.textContent='History loaded. Regional estimates, not a weather forecast.';
    renderMetrics();renderSources();renderSeasonality();
    byId('history-days').replaceChildren();shownDays=0;if(byId('history-daily-details').open)showDays();
    renderChart();localize(root);
    document.dispatchEvent(new CustomEvent('weather-history-loaded',{detail:report}));
  }
  async function load(force=false) {
    const current=++sequence;controller?.abort();clear();
    loading=false;root.setAttribute('aria-busy','false');byId('history-refresh').disabled=false;
    if(unsaved){status.textContent='Save this pin to assess the selected location.';localize(status);return;}
    const key=`${config.latitude},${config.longitude}:${period}`;
    if(!force&&savedReports.has(key)){report=savedReports.get(key);dirty=false;render();return;}
    controller=new AbortController();const activeController=controller;
    const timeout=setTimeout(()=>activeController.abort(),45000);
    loading=true;root.setAttribute('aria-busy','true');byId('history-refresh').disabled=true;
    status.textContent='Loading real weather history for this pin...';localize(status);
    try{
      const response=await fetch('/api/weather/history/?'+new URLSearchParams({period}),{signal:activeController.signal,cache:'no-store'});
      if(!response.ok)throw new Error('History unavailable');
      const data=await response.json();if(current!==sequence)return;
      if(data.status!=='ok'){status.textContent=data.status==='needs_location'?'Save your field pin to load NASA weather data.':'Historical data is unavailable. Try another period or reload.';return;}
      if(!data.summary||!data.coverage||!data.soil||!Array.isArray(data.days)||!data.days.length||
         !Array.isArray(data.months)||!Array.isArray(data.years)||!Array.isArray(data.seasonality)||!Array.isArray(data.source_products))throw new Error('Incomplete history response');
      report=data;slider.value=0;render();savedReports.set(key,data);dirty=false;
    }catch(error){if(current===sequence){savedReports.delete(key);dirty=true;clear();status.textContent=error.name==='AbortError'?'The history request timed out. Try reloading or choose a shorter period.':'Could not load NASA data. Check your connection and try again.';}}
    finally{clearTimeout(timeout);if(current===sequence){loading=false;root.setAttribute('aria-busy','false');byId('history-refresh').disabled=false;localize(status);}}
  }
  root.querySelectorAll('[data-history-period]').forEach(button=>button.addEventListener('click',()=>{
    period=button.dataset.historyPeriod;root.querySelectorAll('[data-history-period]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));load();
  }));
  root.querySelectorAll('[data-history-variable]').forEach(button=>button.addEventListener('click',()=>{
    variable=button.dataset.historyVariable;root.querySelectorAll('[data-history-variable]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));renderChart();
  }));
  slider.addEventListener('input',()=>setReading(Number(slider.value)));
  byId('history-refresh').addEventListener('click',()=>load(true));
  byId('history-more').addEventListener('click',showDays);
  byId('history-daily-details').addEventListener('toggle',()=>{if(byId('history-daily-details').open&&!shownDays)showDays();});
  byId('history-download').addEventListener('click',()=>{
    if(!report)return;
    const keys=['date','rainfall_mm','temperature_c','maximum_c','minimum_c','wind_ms','humidity_percent','soil_surface','soil_root'];
    const headers=['date_utc','rainfall_mm','mean_air_temperature_c','daily_max_air_temperature_c','daily_min_air_temperature_c','mean_wind_at_2m_m_s','relative_humidity_percent',report.soil.surface_parameter+'_'+report.soil.units,report.soil.root_parameter+'_'+report.soil.units];
    const csv=[headers.join(','),...report.days.map(row=>keys.map(key=>row[key]??'').join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
    const link=make('a');link.href=url;link.download=`mekongrise-weather-${Number(config.latitude).toFixed(4)}-${Number(config.longitude).toFixed(4)}-${report.requested_start}-${report.requested_end}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  const start = event=>{if(event.detail?.tab==='weather'){started=true;if(dirty&&!loading)load();else requestAnimationFrame(renderChart);}};
  document.addEventListener('field-results-tab',start);document.addEventListener('field-results-opened',start);
  document.addEventListener('field-location-selected',()=>{unsaved=true;dirty=true;loading=false;++sequence;controller?.abort();savedReports.clear();clear();root.setAttribute('aria-busy','false');byId('history-refresh').disabled=false;status.textContent='Save this pin to assess the selected location.';localize(status);});
  document.addEventListener('field-location-saved',event=>{Object.assign(config,event.detail);unsaved=false;dirty=true;savedReports.clear();if(started&&!byId('results-panel-weather').hidden)load();});
  document.addEventListener('terragrow-language-changed',()=>{if(report)render();});
  let lastWidth=0,frame;
  new ResizeObserver(entries=>{const width=Math.round(entries[0].contentRect.width);if(!width||width===lastWidth)return;lastWidth=width;cancelAnimationFrame(frame);frame=requestAnimationFrame(renderChart);}).observe(byId('history-chart'));
})();
