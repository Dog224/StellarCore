/* Location-driven recommendations. Database membership never determines rank. */
(() => {
  const section=document.getElementById('crop-recommendations');
  const status=document.getElementById('crop-status');
  const refresh=document.getElementById('crop-refresh');
  const environment=document.getElementById('crop-environment');
  const top=document.getElementById('crop-top');
  const other=document.getElementById('crop-other');
  const provenance=document.getElementById('crop-provenance');
  let sequence=0,controller,started=false,unsaved=false,report;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const localize=node=>window.TerraGrowI18n?.refresh(node||section);
  const number=(value,digits=1)=>Number(value).toLocaleString(undefined,{maximumFractionDigits:digits});
  const link=(name,url)=>{const n=el('a',name);n.href=url;n.target='_blank';n.rel='noopener';return n;};
  const levels={higher:'Higher estimated match',moderate:'Moderate estimated match',limited:'Limited estimated match',low:'Low estimated match',outside_range:'Outside published range',unknown:'Insufficient data'};
  const factors={temperature_c:'Typical annual temperature',annual_rainfall_mm:'Typical annual rainfall',elevation_m:'Elevation',ph:'Soil pH',texture:'Soil texture'};
  const states={within_optimal:'Within the published optimal range',below_optimal:'Below the optimal range',above_optimal:'Above the optimal range',
    within_reported_absolute_limit:'Within the reported absolute limit; optimum is not established',outside_absolute:'Outside the published absolute range',
    missing_location_data:'Location information is missing; not counted as a match',missing_requirement:'Reference information is missing; not counted as a match'};
  const seasonReasons={outside_reference_range:'No planting window is proposed for this constrained result.',perennial_establishment_unknown:'Perennial establishment and first harvest require local variety and management information.',
    missing_seasonal_water_reference:'No reliable seasonal water guide is available for this crop; a planting window was not invented.',
    missing_monthly_climate:'Monthly climate data is unavailable.',rainfed_window_not_identified:'No rain-fed planning window was identified. A local calendar and water assessment are needed.'};
  function renderMarket(box,reference){
    box.replaceChildren(el('strong','Market reference / kg'));
    const entries=reference?.entries||[];
    if(!entries.length)box.append(el('p','No matching price is provided in this spreadsheet.'));
    for(const item of entries){
      if(entries.length>1){const name=el('span',item.name,'crop-market-variety');name.dataset.noTranslate='';box.append(name);}
      const value=window.MekongRiseMarket?.formatPrice(item.laos_price,'LAK')|| (item.laos_price?item.laos_price.map(number=>Number(number).toLocaleString()).join(' – ')+' LAK / kg':null);
      const text=el('p',value||'Not provided in the sheet');if(value)text.dataset.noTranslate='';box.append(text);
    }
    if(entries.length){const note=el('small');note.append(el('span','Lao market'),' · ',el('span',String(reference.source_year)),' ',el('span','spreadsheet reference'));box.append(note);}
    const more=el('button',entries.length?'Learn more and compare prices':'Browse all market prices','crop-market-link');more.type='button';
    more.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('market-request',{detail:{ids:entries.map(item=>item.id)}})));
    box.append(more);localize(box);
  }
  function fact(parent,label,value){const row=el('div',undefined,'crop-fact');row.append(el('dt',label),el('dd',value));parent.append(row);return row;}
  const range=values=>values?.map(v=>v===null?'…':typeof v==='number'?number(v):v).join(values.every(v=>v===null||typeof v==='number')?'–':', ')||'—';
  function clear(message){
    report=null;top.replaceChildren();other.replaceChildren();environment.replaceChildren();provenance.replaceChildren();
    status.textContent=message;section.dataset.status='pending';localize();
  }
  function renderEnvironment(data){
    environment.replaceChildren();
    for(const [key,unit] of [['temperature_c','°C'],['annual_rainfall_mm','mm/year'],['elevation_m','m']]){
      const box=el('div'),value=el('strong',data[key]===null||data[key]===undefined?'—':number(data[key]));
      if(data[key]!==null&&data[key]!==undefined)value.append(document.createTextNode(' '),el('small',unit));
      box.append(el('span',factors[key]),value);environment.append(box);
    }
    if(data.climate?.fallback)environment.append(el('p','FAO climate is unavailable. Coarser NASA climate is being used and may miss local terrain effects.','crop-data-warning'));
  }
  function renderSources(data){
    provenance.replaceChildren();
    const method=el('p','This is a transparent MekongRise screening score, not an official FAO score or a probability of a successful harvest.','data-note');
    provenance.append(method,el('p','Weights: temperature 40, annual rainfall 35, elevation 10, soil pH 10, soil texture 5. Missing factors are excluded from the weighted average. A known absolute limit constrains the score to zero.','data-note'));
    const weights=el('p','Both temperature and annual rainfall must be available to rank crops. Unknown soil conditions remain unknown.','data-note');provenance.append(weights);
    for(const [name,source] of [['Annual climate',data.environment.climate],['Monthly planting-window climate',data.environment.seasonal_climate],['Terrain',data.environment.terrain]]){
      const block=el('div',undefined,'crop-source-block');block.append(el('strong',name),el('p',source?.source||'Unavailable'));
      if(source?.dataset_period)block.append(el('p',source.dataset_period,'data-note'));
      if(source?.resolution)block.append(el('p',source.resolution,'data-note'));
      if(source?.retrieved_at)block.append(el('p',new Date(source.retrieved_at).toISOString(),'data-note'));
      if(source?.source_url)block.append(link('Dataset source',source.source_url));
      for(const [caption,dataset] of [['Temperature raster',source?.temperature_dataset],['Rainfall raster',source?.rainfall_dataset]]){
        if(dataset?.raster_url)block.append(link(caption,dataset.raster_url));
      }
      provenance.append(block);
    }
    provenance.append(el('p','Historical FAO ECOCROP sheets are undated. Each crop links its source and retrieval date. Species descriptors do not establish performance of a local variety.','data-note'),
      el('p','Nearby pins may share a climate grid cell. Equal environmental evidence can legitimately produce equal rankings.','data-note'),
      el('p','Satellites do not directly measure soil fertility. These estimates are not verified local agricultural advice and do not guarantee harvest success.','crop-data-warning'));
  }
  function buildCard(crop,data){
    const article=el('article',undefined,'ranked-crop');article.dataset.crop=crop.id;article.dataset.level=crop.level;article.dataset.score=crop.score===null?'':crop.score;
    const figure=el('figure',undefined,'crop-photo');
    const image=el('img');image.src=crop.image_url;image.alt=crop.name;image.width=640;image.height=420;image.loading='lazy';image.decoding='async';
    image.style.objectPosition=crop.image_credit?.framing||'50% 50%';figure.append(image);
    image.addEventListener('error',()=>{image.hidden=true;figure.prepend(el('p','Photograph unavailable','crop-photo-unavailable'));localize(figure);},{once:true});
    if(crop.image_credit){
      const credit=crop.image_credit,caption=el('figcaption');
      const author=link(credit.author,credit.source_url);author.dataset.noTranslate='';
      const license=link(credit.license,credit.license_url);license.dataset.noTranslate='';
      caption.append(el('span','Photo'),document.createTextNode(': '),author,document.createTextNode(' · '),license);figure.append(caption);
    }
    article.append(figure);
    const body=el('div',undefined,'ranked-crop-body');
    const heading=el('h3');if(crop.rank!==null)heading.append(el('small',String(crop.rank)));heading.append(el('span',crop.name));
    const score=el('strong',crop.score===null?'—':`${number(crop.score)} / 100`,'crop-score');
    const rating=el('div',undefined,'crop-rating-row');rating.append(el('p',levels[crop.level],'crop-level'),score);
    body.append(heading,rating);
    const evidence=el('p',undefined,'data-note crop-evidence');evidence.append(el('span','Score on available factors only'),document.createTextNode(' · '),el('span',`${crop.assessed_factors}/${crop.total_factors} `),el('span','factors checked'));body.append(evidence);
    const why=el('ul',undefined,'crop-short-reasons');
    for(const check of crop.checks.filter(c=>['temperature_c','annual_rainfall_mm'].includes(c.factor))){
      const item=el('li');item.append(el('span',factors[check.factor]),el('strong',check.reading===null?'—':`${number(check.reading)} ${check.unit||''}`),el('span',states[check.state]||check.state));why.append(item);
    }
    body.append(why);
    const market=el('section',undefined,'crop-market-reference');renderMarket(market,crop.market_reference);body.append(market);
    market.dataset.cropMarket=crop.id;
    const details=el('details',undefined,'crop-details');details.append(el('summary','Details and planting estimates'));
    const facts=el('dl',undefined,'crop-facts');
    const water=crop.water.seasonal_mm;
    fact(facts,'Seasonal crop water guide',water?`${range(water)} mm`:'Unknown');
    if(water){details.append(el('p','Crop water need is not the irrigation amount. Effective rainfall, drainage and rice flooding losses are not established.','data-note'));}
    const days=crop.duration.days;
    fact(facts,crop.perennial?'Established-crop cycle':'Estimated growing duration',days?.every(v=>v!==null)?`${range(days)} d`:'Unknown');
    if(crop.perennial)facts.append(el('p','This cycle is not time from planting to first harvest.','data-note'));
    const season=crop.season;
    if(season.status==='estimated'){
      const locale=document.documentElement.lang==='th'?'th-TH-u-ca-gregory':document.documentElement.lang==='lo'?'lo-LA-u-ca-gregory':'en-US';
      const monthNames=season.months.map(m=>new Intl.DateTimeFormat(locale,{month:'long'}).format(new Date(2025,m-1,1)));
      fact(facts,'Estimated planting months',monthNames.join(', '));
      fact(facts,'If planted on',season.next_start);
      fact(facts,'Conditional harvest period',`${season.harvest_start} – ${season.harvest_end}`);
      details.append(el('p','A climate-based planning window, not a local planting calendar or a rain forecast. Dates assume the displayed planting day and reference growing duration.','data-note'),
        el('p','Monthly NASA climate is coarser than the annual FAO layers and may differ over mountains. Confirm the season locally.','data-note'));
      if(season.dataset_period)details.append(el('p',season.dataset_period,'data-note'));
    }else{
      fact(facts,'Estimated planting months','Not established');fact(facts,'Conditional harvest period','Not established');
      details.append(el('p',seasonReasons[season.reason]||'Not established','data-note'));
    }
    details.append(facts);
    const checks=el('div',undefined,'crop-factor-checks');
    for(const check of crop.checks){
      const row=el('section');row.append(el('h4',factors[check.factor]),el('p',states[check.state]||check.state));
      const limits=el('p',undefined,'data-note');limits.append(el('span','Optimal'),document.createTextNode(`: ${range(check.optimal)}; `),el('span','Absolute'),document.createTextNode(`: ${range(check.absolute)} ${check.unit||''}`));
      row.append(limits);checks.append(row);
    }
    details.append(checks);
    const sources=el('div',undefined,'crop-source-block');sources.append(el('p',crop.scientific_name,'data-note'),link('FAO ECOCROP requirements',crop.source.url),
      el('p','Source sheet is undated; retrieved on','data-note'),el('p',crop.source.retrieved_on,'data-note'),link('Growing-duration source',crop.duration.source_url));
    if(crop.water.source_url)sources.append(link('FAO seasonal water reference',crop.water.source_url));
    if(crop.water.retrieved_on)sources.append(el('p','Source sheet is undated; retrieved on','data-note'),el('p',crop.water.retrieved_on,'data-note'));
    for(const note of crop.notes)sources.append(el('p',note,'data-note'));
    if(crop.image_credit){
      const credit=crop.image_credit;
      sources.append(el('p','Reference crop photograph, not an observation of your field.','data-note'),
        link(credit.title,credit.source_url),el('p',credit.author,'data-note'),link(credit.license,credit.license_url),
        el('p','Photo cropped for display.','data-note'));
    }else sources.append(el('p','Crop illustration, not an observation of your field.','data-note'));
    details.append(sources);
    const gaez=el('div',undefined,'crop-gaez-context');
    gaez.append(el('p','FAO GAEZ is an independent regional model check. It is not blended into this range-screen score.','data-note'));
    const gaezStatus=el('p',crop.gaez_available?'Open details to load the regional GAEZ check.':'No matching GAEZ crop is available. No substitute crop was used.','data-note');gaez.append(gaezStatus);details.append(gaez);
    let requested=false;
    details.addEventListener('toggle',async()=>{
      if(!details.open||requested||!crop.gaez_available||!controller)return;
      requested=true;const current=sequence;const signal=controller.signal;
      gaezStatus.textContent='Loading FAO grid cell...';localize(article);
      try{
        const response=await fetch('/api/crops/gaez/?'+new URLSearchParams({crop:crop.id,pin:data.pin}),{signal,cache:'no-store'});
        if(!response.ok)throw new Error('GAEZ unavailable');const result=await response.json();
        if(current!==sequence||unsaved)return;
        gaezStatus.textContent=result.status==='ok'?'FAO GAEZ suitability index':'The regional GAEZ check is unavailable or has no data.';
        if(result.status==='ok')gaez.append(el('strong',`${number(result.value)} ${result.unit||''}`));
        if(result.period_note)gaez.append(el('p',result.period_note,'data-note'));
        gaez.append(el('p','Comparison scenario: rain-fed farming with low inputs. Actual management is unknown.','data-note'));
        if(result.raster_url)gaez.append(link('Source GeoTIFF',result.raster_url));
        for(const note of result.crop_notes||[])gaez.append(el('p',note,'data-note'));
      }catch{if(current===sequence&&!unsaved)gaezStatus.textContent='The regional GAEZ check is unavailable or has no data.';}
      localize(article);
    });
    body.append(details);article.append(body);return article;
  }
  function render(data){
    top.replaceChildren();other.replaceChildren();
    section.dataset.status=data.status;
    if(data.status==='needs_location'){status.textContent='Save a field pin to start';localize();return;}
    renderEnvironment(data.environment);renderSources(data);
    status.replaceChildren(el('span','Crops evaluated'),document.createTextNode(`: ${data.crops.length}`));
    const selected=new Set(data.recommendations);
    for(const crop of data.crops)(selected.has(crop.id)?top:other).append(buildCard(crop,data));
    if(!selected.size)top.append(el('p',data.status==='unavailable'?'Required climate data is unavailable. No crop recommendation was invented.':'No crop reaches the screening threshold with the available information. Consult a local agricultural adviser.','crop-data-warning'));
    localize();
  }
  async function load(){
    const current=++sequence;controller?.abort();controller=new AbortController();const thisController=controller;
    clear(unsaved?'Save this pin to assess the selected location.':'Comparing crop requirements with this location...');
    if(unsaved)return;
    section.setAttribute('aria-busy','true');refresh.disabled=true;
    const timeout=setTimeout(()=>thisController.abort(),45000);
    try{
      const response=await fetch('/api/crops/recommendations/',{signal:thisController.signal,cache:'no-store'});
      if(!response.ok)throw new Error('Recommendation request unavailable');const data=await response.json();
      if(current!==sequence||unsaved)return;report=data;render(data);
    }catch{if(current===sequence&&!unsaved){clear('Could not retrieve location data. No crop recommendation was invented.');localize();}}
    finally{clearTimeout(timeout);if(current===sequence){refresh.disabled=false;section.setAttribute('aria-busy','false');}}
  }
  refresh.addEventListener('click',()=>{started=true;load();});
  document.addEventListener('field-results-opened',()=>{if(!started){started=true;load();}});
  document.addEventListener('field-location-selected',()=>{unsaved=true;++sequence;controller?.abort();clear('Save this pin to assess the selected location.');refresh.disabled=false;section.setAttribute('aria-busy','false');});
  document.addEventListener('field-location-saved',()=>{unsaved=false;if(started)load();});
  document.addEventListener('terragrow-language-changed',()=>{if(report)render(report);});
  document.addEventListener('market-display-changed',()=>{
    if(!report)return;
    document.querySelectorAll('[data-crop-market]').forEach(box=>{
      const crop=report.crops.find(item=>item.id===box.dataset.cropMarket);if(crop)renderMarket(box,crop.market_reference);
    });
  });
})();
