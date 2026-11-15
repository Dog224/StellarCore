/* The supplied sheet is a dated reference catalogue, not a live market feed. */
(() => {
  const dialog=document.getElementById('market-dialog');if(!dialog)return;
  const byId=id=>document.getElementById(id), pageSize=8;
  const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  const noTranslate=node=>{node.dataset.noTranslate='';return node;};
  const localize=()=>window.TerraGrowI18n?.refresh(dialog);
  let data,fx,loading,ratePromise,page=0,selected,limitIds=null,currency='LAK';
  try{const saved=localStorage.getItem('mekongrise-market-currency');if(['LAK','USD','THB'].includes(saved))currency=saved;}catch{}
  byId('market-currency').value=currency;
  function converted(values,base){
    if(!values)return null;
    const rates=fx?.rates;
    const possible=currency===base || (rates?.[currency]>0&&rates?.[base]>0);
    const factor=currency===base?1:possible?rates[currency]/rates[base]:1;
    return {values:values.map(value=>value*factor),currency:possible?currency:base};
  }
  const amount=(value,code)=>new Intl.NumberFormat(document.documentElement.lang==='lo'?'lo-LA':document.documentElement.lang==='th'?'th-TH':'en-GB',
    {minimumFractionDigits:code==='LAK'?0:2,maximumFractionDigits:code==='LAK'?0:2}).format(value);
  const price=(values,base)=>{const quote=converted(values,base);return quote?`${amount(quote.values[0],quote.currency)} – ${amount(quote.values[1],quote.currency)} ${quote.currency} / kg`:null;};
  const nativePrice=(values,base)=>values?`${amount(values[0],base)} – ${amount(values[1],base)} ${base} / kg`:null;
  function rateNote(){
    const node=byId('market-rate-status');node.replaceChildren();
    if(!fx){node.append(make('span','Loading exchange-rate information...'));return;}
    if(!fx.rates?.LAK||!fx.rates?.THB){node.append(make('span','Conversion unavailable. Original currencies are shown.'));return;}
    node.append(make('span',fx.status==='stale'?'Using saved reference exchange rates.':'Dated reference exchange rates.'),' ',
      noTranslate(make('span',`1 USD = ${amount(fx.rates.LAK,'LAK')} LAK · ${amount(fx.rates.THB,'THB')} THB`)),' ',
      noTranslate(make('span',`(${fx.dates.LAK}${fx.dates.THB!==fx.dates.LAK?' / '+fx.dates.THB:''})`)),' ',
      Object.assign(make('a','Frankfurter'),{href:'https://frankfurter.dev/',target:'_blank',rel:'noopener'}));
  }
  async function rates(reload=false){
    if(ratePromise&&!reload)return ratePromise;
    ratePromise=(async()=>{
      try{
        const response=await fetch('/api/market/rates/',{signal:AbortSignal.timeout(12000),cache:'no-store'});
        if(!response.ok)throw new Error('Rates unavailable');fx=await response.json();
      }catch{fx={status:'unavailable',rates:{}};}
      rateNote();if(data)render();localize();
      document.dispatchEvent(new CustomEvent('market-display-changed'));
      return fx;
    })();
    return ratePromise;
  }
  function filtered(){
    const query=byId('market-search').value.trim().toLocaleLowerCase(),group=byId('market-group').value;
    return data.crops.filter(crop=>(!limitIds||limitIds.includes(crop.id))&&(!group||crop.group===group)&&
      (!query||`${crop.name} ${crop.name_lo}`.toLocaleLowerCase().includes(query)));
  }
  function chart(crop){
    const root=byId('market-price-chart');root.replaceChildren();
    let series=[{label:'Lao market',quote:converted(crop.laos_price,'LAK'),className:'market-range-local'},
                {label:'World reference',quote:converted(crop.world_price,'USD'),className:'market-range-world'}].filter(item=>item.quote);
    if(!series.length){root.append(make('p','No numeric price is supplied for this plant.'));return;}
    const graphCurrency=series.find(item=>item.quote.currency===currency)?.quote.currency||series[0].quote.currency;
    series=series.filter(item=>item.quote.currency===graphCurrency);
    const svgNode=(tag,attrs,text)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;return node;};
    const svg=svgNode('svg',{viewBox:'0 0 480 165',role:'img','aria-label':'Price range per kilogram'});
    const description=svgNode('desc',{},series.map(item=>item.label+': '+item.quote.values.map(value=>amount(value,graphCurrency)).join(' – ')+' '+graphCurrency+' / kg').join('; '));
    svg.append(description);
    const maximum=Math.max(...series.flatMap(item=>item.quote.values))*1.12;
    const x=value=>42+value/maximum*400;
    for(let tick=0;tick<=2;tick++){
      const value=maximum*tick/2;
      svg.append(svgNode('line',{x1:x(value),x2:x(value),y1:27,y2:131,class:'market-graph-grid'}),
        svgNode('text',{x:x(value),y:151,'text-anchor':tick===0?'start':tick===2?'end':'middle',class:'market-graph-tick'},amount(value,graphCurrency)));
    }
    series.forEach((item,index)=>{
      const y=47+index*56;
      svg.append(svgNode('text',{x:42,y:y-15,class:'market-graph-label'},item.label),
        svgNode('line',{x1:x(item.quote.values[0]),x2:x(item.quote.values[1]),y1:y,y2:y,class:item.className}),
        ...item.quote.values.map(value=>svgNode('circle',{cx:x(value),cy:y,r:4,class:item.className})));
    });
    root.append(svg,noTranslate(make('p',graphCurrency+' / kg','market-graph-unit')));
    if(!fx?.rates?.LAK)root.append(make('p','Only ranges in the same currency are compared.','market-graph-hint'));
  }
  function details(crop){
    byId('market-selected').hidden=!crop;if(!crop)return;
    byId('market-selected-group').textContent=crop.group_name;
    byId('market-plant-name').textContent=crop.name;byId('market-plant-lao').textContent=crop.name_lo;
    const summary=byId('market-price-summary');summary.replaceChildren();
    for(const [label,values,base]of [['Lao market',crop.laos_price,'LAK'],['World reference',crop.world_price,'USD']]){
      const block=make('div');block.append(make('span',label));
      block.append(values?noTranslate(make('strong',price(values,base))):make('strong','Not provided in the sheet'));
      summary.append(block);
    }
    chart(crop);
    const duration=byId('market-growing-days');duration.replaceChildren();
    if(crop.growing_days)duration.append(noTranslate(make('span',crop.growing_days.join('–'))),' ',make('span','days'));else duration.append(make('span','Not provided in the sheet'));
    byId('market-laos-season').textContent=crop.seasons.Laos;
    const more=byId('market-extra');more.replaceChildren();
    more.append(make('p','Planting seasons from the sheet','market-extra-heading'),make('p','Source calendar notes are in Lao.','market-small-note'));
    const seasons=make('dl',undefined,'market-season-list');
    for(const [country,value]of Object.entries(crop.seasons)){
      const row=make('div'),notes=noTranslate(make('dd',value));notes.lang='lo';row.append(make('dt',country),notes);seasons.append(row);
    }
    more.append(seasons);
    for(const note of crop.price_notes)more.append(make('p',note,'market-product-note'));
    const original=make('div',undefined,'market-original-prices');original.append(make('strong','Original source prices'));
    for(const [label,values,base]of [['Lao market',crop.laos_price,'LAK'],['World reference',crop.world_price,'USD']]){
      const row=make('p');row.append(make('span',label),': ',values?noTranslate(make('span',nativePrice(values,base))):make('span','Not provided in the sheet'));original.append(row);
    }
    more.append(original);
    const raw=make('details',undefined,'market-original-row');raw.append(make('summary','All original spreadsheet cells'));
    const cells=make('dl');data.headers_lo.forEach((header,index)=>{const row=make('div');row.append(make('dt',header),make('dd',crop.raw_row[index]));cells.append(row);});cells.lang='lo';cells.dataset.noTranslate='';raw.append(cells);more.append(raw);
    byId('market-row-source').href=crop.source_url;
    byId('market-row-source').textContent='View this plant in the spreadsheet ↗';
  }
  function select(crop,focus=false){
    selected=crop.id;details(crop);
    document.querySelectorAll('[data-market-select]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.marketSelect===selected)));
    if(focus){byId('market-more').open=true;byId('market-plant-name').focus({preventScroll:true});byId('market-selected').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});}
    localize();
  }
  function render(){
    if(!data)return;
    const crops=filtered(),pages=Math.max(1,Math.ceil(crops.length/pageSize));page=Math.min(page,pages-1);
    if(!crops.some(crop=>crop.id===selected))selected=crops[0]?.id;
    byId('market-status').replaceChildren(make('span','Matching plants'),': ',noTranslate(make('span',String(crops.length))),' · ',noTranslate(make('span',String(data.source_rows))),' ',make('span','source rows'));
    const rows=byId('market-rows');rows.replaceChildren();
    for(const crop of crops.slice(page*pageSize,(page+1)*pageSize)){
      const row=make('tr'),nameCell=make('td'),button=make('button',undefined,'market-plant-select');button.type='button';button.dataset.marketSelect=crop.id;button.setAttribute('aria-pressed',String(crop.id===selected));
      button.append(noTranslate(make('strong',crop.name)),Object.assign(noTranslate(make('small',crop.name_lo)),{lang:'lo'}));button.addEventListener('click',()=>select(crop));nameCell.append(button);row.append(nameCell);
      for(const [label,values,base]of [['Lao market / kg',crop.laos_price,'LAK'],['World reference / kg',crop.world_price,'USD']]){
        const cell=make('td');cell.append(make('span',label,'market-mobile-label'),values?noTranslate(make('span',price(values,base))):make('span','Not provided in the sheet'));row.append(cell);
      }
      const action=make('td'),learn=make('button','Learn more','market-learn');learn.type='button';learn.addEventListener('click',()=>select(crop,true));action.append(learn);row.append(action);rows.append(row);
    }
    byId('market-page').textContent=`${crops.length?page*pageSize+1:0}–${Math.min((page+1)*pageSize,crops.length)} / ${crops.length}`;
    byId('market-previous').disabled=page===0;byId('market-next').disabled=page>=pages-1;
    details(crops.find(crop=>crop.id===selected));rateNote();localize();
  }
  async function load(reload=false){
    rates(reload);
    if(data&&!reload){render();return;}
    if(loading)return loading;
    byId('market-reload').disabled=true;
    loading=(async()=>{
      try{
        const response=await fetch('/api/market/',{signal:AbortSignal.timeout(12000),cache:'no-store'});
        const result=await response.json();if(!response.ok||result.status!=='ok'||!Array.isArray(result.crops))throw new Error('Sheet unavailable');
        data=result;const groups=byId('market-group');groups.replaceChildren(Object.assign(make('option','All crop groups'),{value:''}));
        data.groups.forEach(group=>groups.append(Object.assign(make('option',group.name),{value:group.id})));
        byId('market-reference-badge').replaceChildren(noTranslate(make('span',String(data.source.reference_year))),' ',make('span','reference · per kg'));
        byId('market-import-date').textContent=`${data.source.reference_year} · ${data.source.retrieved_at.slice(0,10)} (UTC) · ${data.source_rows} source rows / ${data.product_count} products`;
        byId('market-source-notes').replaceChildren(make('p',data.title_lo),make('p',data.note_lo));render();
      }catch{byId('market-status').textContent='Market data could not load. Try again.';localize();}
      finally{byId('market-reload').disabled=false;loading=null;}
    })();return loading;
  }
  document.querySelectorAll('[data-dialog="market-dialog"]').forEach(button=>button.addEventListener('click',()=>{limitIds=null;page=0;load();}));
  byId('market-search').addEventListener('input',()=>{limitIds=null;page=0;render();});
  byId('market-group').addEventListener('change',()=>{limitIds=null;page=0;render();});
  byId('market-currency').addEventListener('change',()=>{currency=byId('market-currency').value;try{localStorage.setItem('mekongrise-market-currency',currency);}catch{}render();document.dispatchEvent(new CustomEvent('market-display-changed'));});
  byId('market-previous').addEventListener('click',()=>{page=Math.max(0,page-1);render();});byId('market-next').addEventListener('click',()=>{page++;render();});
  byId('market-reload').addEventListener('click',()=>load(true));
  document.addEventListener('market-request',event=>{
    limitIds=event.detail?.ids?.length?event.detail.ids:null;page=0;byId('market-search').value='';byId('market-group').value='';
    document.querySelectorAll('dialog[open]').forEach(other=>other.close());dialog.showModal();load();
  });
  document.addEventListener('terragrow-language-changed',()=>{if(data&&(dialog.open||dialog.hasAttribute('data-market-page')))render();});
  document.addEventListener('market-page-ready',()=>{
    const requested=new URLSearchParams(location.search).get('products');
    if(requested)limitIds=requested.split(',').filter(id=>/^[a-z0-9-]+$/.test(id));
    load();
  });
  document.addEventListener('field-results-opened',event=>{if(event.detail?.tab==='crops')rates();});
  window.MekongRiseMarket={formatPrice:price,get currency(){return currency;}};
})();
