/* Vector overview and an explicit handoff to Google's panoramic photo viewer. */
(() => {
  document.addEventListener('field-map-ready', event => {
    const {map,region}=event.detail;
    const byId=id=>document.getElementById(id);
    const panel=byId('map'), overview=byId('map-overview'), slot=byId('map-overview-slot');
    const toggle=byId('overview-toggle'), countryButton=byId('country-view'), streetButton=byId('street-view-toggle');
    const dialog=byId('street-view-dialog'), streetLink=byId('street-view-link');
    let fieldPoint=event.detail.point, streetMarker, picking=false, explicitlyToggled=false;
    const bounds=L.geoJSON(region).getBounds();
    const localize=node=>window.TerraGrowI18n?.refresh(node);
    const status=message=>{byId('map-status').textContent=message;localize(byId('map-status'));};
    const inside=point=>point && window.TerraGrowRegion.contains(region,point.lat,point.lng);
    const countryAt=point=>point && region.features.find(feature=>window.TerraGrowRegion.contains({features:[feature]},point.lat,point.lng));
    const mini=L.map('mini-map',{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,
      doubleClickZoom:false,boxZoom:false,keyboard:false,touchZoom:false,tapHold:false,zoomSnap:0});
    mini.setView(bounds.getCenter(),4,{animate:false});
    byId('mini-map').removeAttribute('tabindex');
    const shapes=L.geoJSON(region,{style:{color:'#789475',weight:1,fillColor:'#c8dbb9',fillOpacity:.9},interactive:false}).addTo(mini);
    const names={LAO:'LA',VNM:'VN',THA:'TH',KHM:'KH',MMR:'MM'};
    for(const feature of region.features){
      const center=L.geoJSON(feature).getBounds().getCenter();
      L.marker(center,{interactive:false,keyboard:false,icon:L.divIcon({className:'mini-country-label',html:names[feature.properties.code]||'',iconSize:[22,15],iconAnchor:[11,7]})}).addTo(mini);
    }
    const viewport=L.rectangle(map.getBounds(),{className:'overview-viewport',color:'#c39736',weight:2,fillOpacity:.12,interactive:false}).addTo(mini);
    let dot;
    const updateDot=()=>{
      if(!inside(fieldPoint))return;
      const country=countryAt(fieldPoint);
      shapes.setStyle(feature=>({fillColor:feature.properties.code===country?.properties.code?'#78a16c':'#c8dbb9'}));
      if(dot)dot.setLatLng(fieldPoint);
      else dot=L.circleMarker(fieldPoint,{className:'overview-field-dot',radius:4,fillColor:'#286747',fillOpacity:1,color:'#fff',weight:1.5,interactive:false}).addTo(mini);
    };
    const refreshMini=()=>{
      if(overview.hidden)return;
      mini.invalidateSize({pan:false});mini.fitBounds(bounds,{padding:[8,8],animate:false});
      viewport.setBounds(map.getBounds());updateDot();
    };
    const showMini=visible=>{overview.hidden=!visible;toggle.setAttribute('aria-expanded',String(visible));requestAnimationFrame(refreshMini);};
    const layout=()=>{
      const compact=map.getSize().x<650;
      overview.classList.toggle('overview-inline',compact);
      const parent=compact?slot:panel;
      if(overview.parentElement!==parent)parent.append(overview);
      if(!explicitlyToggled)showMini(!compact);else requestAnimationFrame(refreshMini);
    };
    const navigate=()=>map.fire('explorer-navigation');
    toggle.disabled=false;streetButton.disabled=false;
    toggle.addEventListener('click',()=>{explicitlyToggled=true;showMini(overview.hidden);});
    byId('overview-close').addEventListener('click',()=>{explicitlyToggled=true;showMini(false);toggle.focus();});
    byId('overview-region').addEventListener('click',()=>{navigate();map.fitBounds(bounds,{padding:[16,16],maxZoom:6,animate:!matchMedia('(prefers-reduced-motion:reduce)').matches});});
    mini.on('click',click=>{if(inside(click.latlng)){navigate();map.panTo(click.latlng,{animate:!matchMedia('(prefers-reduced-motion:reduce)').matches});}});
    const setCountryState=()=>{countryButton.disabled=!countryAt(fieldPoint||map.getCenter());};
    countryButton.addEventListener('click',()=>{
      const country=countryAt(fieldPoint||map.getCenter());if(!country)return;
      navigate();map.fitBounds(L.geoJSON(country).getBounds(),{padding:[24,24],animate:!matchMedia('(prefers-reduced-motion:reduce)').matches});
      status('Showing the country around your pin. Your field pin is unchanged.');
    });
    map.on('moveend zoomend',()=>{viewport.setBounds(map.getBounds());setCountryState();});
    map.on('resize',layout);
    const setPicking=active=>{
      picking=active;panel.classList.toggle('street-picking',active);streetButton.setAttribute('aria-pressed',String(active));
      document.dispatchEvent(new CustomEvent('street-view-picking',{detail:{active}}));
    };
    const showStreet=point=>{
      setPicking(false);
      if(inside(point)){
        const coordinates=`${point.lat.toFixed(7)},${point.lng.toFixed(7)}`;
        const url=new URL('https://www.google.com/maps/@');
        url.searchParams.set('api','1');url.searchParams.set('map_action','pano');url.searchParams.set('viewpoint',coordinates);
        streetLink.href=url.href;streetLink.hidden=false;
        byId('street-view-point').textContent=`${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
        if(streetMarker)streetMarker.setLatLng(point);
        else streetMarker=L.circleMarker(point,{radius:8,color:'#fff',weight:3,fillColor:'#d1a131',fillOpacity:1}).addTo(map);
      }else{
        streetLink.removeAttribute('href');streetLink.hidden=true;byId('street-view-point').textContent='';
      }
      status('Street-level photo viewer opened. Your field pin is unchanged.');
      document.querySelectorAll('dialog[open]').forEach(other=>other.close());dialog.showModal();localize(dialog);
    };
    streetButton.addEventListener('click',()=>{
      if(picking){setPicking(false);status('Street View selection cancelled.');return;}
      showStreet(fieldPoint||map.getCenter());
    });
    byId('street-view-pick').addEventListener('click',()=>{
      dialog.close();setPicking(true);byId('live-map').focus({preventScroll:true});
      status('Tap a road on the map to look for street-level photos. Your field pin will not change.');
    });
    document.addEventListener('street-view-point',e=>showStreet(L.latLng(e.detail.latitude,e.detail.longitude)));
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&picking){setPicking(false);status('Street View selection cancelled.');streetButton.focus();}});
    dialog.addEventListener('close',()=>{if(streetMarker){map.removeLayer(streetMarker);streetMarker=null;}});
    document.addEventListener('field-results-ready',()=>setPicking(false));
    document.addEventListener('field-location-selected',e=>{setPicking(false);fieldPoint=L.latLng(e.detail.latitude,e.detail.longitude);updateDot();setCountryState();});
    document.addEventListener('field-location-saved',e=>{fieldPoint=L.latLng(e.detail.latitude,e.detail.longitude);updateDot();setCountryState();});
    // No extra imagery service or full-world tile downloads for the mini map.
    updateDot();setCountryState();layout();localize(overview);
  },{once:true});
})();
