(() => {
  const status = document.getElementById('map-status');
  if (!window.L) {
    status.textContent = 'Map could not load. Refresh the page to try again.';
    return;
  }
  const config = JSON.parse(document.getElementById('map-config').textContent);
  const region = JSON.parse(document.getElementById('map-region').textContent);
  const inRegion = latlng => {
    const point = L.latLng(latlng);
    return window.TerraGrowRegion.contains(region, point.lat, point.lng);
  };
  const regionMessage = 'Choose a location in Laos, Thailand, Myanmar, Cambodia or Vietnam.';
  const regionBounds = L.latLngBounds([region.bbox[1], region.bbox[0]], [region.bbox[3], region.bbox[2]]);
  let hasSavedPin = config.latitude !== null && config.longitude !== null;
  const map = L.map('live-map', { zoomControl: false, minZoom: 4, maxZoom: 19,
    maxBounds: regionBounds.pad(.025), maxBoundsViscosity: 1 });
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
  }).addTo(map);
  if (hasSavedPin) map.setView([config.latitude, config.longitude], 16);
  else map.fitBounds(regionBounds, { padding: [16, 16], maxZoom: 6 });
  map.setMinZoom(map.getBoundsZoom(regionBounds, false, L.point(32, 32)));
  // The rectangle limits panning; country polygons enforce actual selection.
  // Shade unsupported land/sea without intercepting map taps or dragging.
  map.createPane('coverage');
  map.getPane('coverage').style.zIndex = 350;
  map.getPane('coverage').style.pointerEvents = 'none';
  const maskRings = [[[-85, -180], [-85, 180], [85, 180], [85, -180]]];
  region.features.forEach(feature => {
    const geometry = feature.geometry;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    polygons.forEach(rings => rings.forEach(ring => maskRings.push(ring.map(([lon, lat]) => [lat, lon]))));
  });
  L.polygon(maskRings, { pane: 'coverage', stroke: false, fillColor: '#152d26', fillOpacity: .65,
    fillRule: 'evenodd', interactive: false }).addTo(map);
  L.geoJSON(region, { pane: 'coverage', interactive: false,
    style: { color: '#dbf5ac', weight: 2, opacity: .9, fill: false },
    attribution: 'Coverage borders: <a href="https://www.naturalearthdata.com/">Natural Earth</a> (generalized)',
  }).addTo(map);
  let fieldMarker, candidate, locationMarker, accuracyCircle, resultsMarker;
  let lastFieldPoint;
  let locationRequest = 0;
  let userMovedMap = false;
  let savePending = false;
  let streetViewPicking = false;
  const saveButton = document.getElementById('save-location');
  const pinState = document.getElementById('field-pin-state');
  const localize = element => window.TerraGrowI18n?.refresh(element);
  const setStatus = message => { status.textContent = message; localize(status); };
  const fieldIcon = L.divIcon({ className: 'field-map-marker', html: '<span></span>', iconSize: [44, 54], iconAnchor: [22, 54] });
  const pinResultsHTML = '<button type="button" id="view-field-results" class="pin-results-button" aria-haspopup="dialog" aria-label="View results for this location"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V10M12 14C5 14 3 9 3 4c6 0 9 3 9 10Zm0-3C12 5 16 2 22 2c0 6-3 10-10 10ZM6 21h12"/></svg><span class="pin-results-label">View results</span><span aria-hidden="true">&#8594;</span></button>';
  function updateResultButtons() {
    document.querySelectorAll('[data-field-results-trigger],.pin-results-button').forEach(button => {
      button.disabled = savePending || (!candidate && !hasSavedPin);
      const label = button.querySelector('.pin-results-label') || button.querySelector('span:not([aria-hidden])');
      if (label) label.textContent = savePending ? 'Saving location...' : 'View results';
      localize(button);
    });
  }
  function bindPinAction() {
    const button = resultsMarker?.getElement()?.querySelector('button');
    if (!button) return;
    L.DomEvent.disableClickPropagation(button);
    button.onclick = event => { L.DomEvent.stop(event); viewFieldResults(); };
    updateResultButtons();
  }
  function positionResultsMarker() {
    if (!resultsMarker) return;
    const pixel = map.latLngToContainerPoint(resultsMarker.getLatLng());
    const width = map.getSize().x;
    const left = width < 520 ? Math.max(8, Math.min(width - 218, pixel.x - 105)) :
      (pixel.x + 235 > width ? Math.max(8, pixel.x - 230) : pixel.x + 25);
    const anchor = [Math.round(pixel.x - left), width < 520 ? (pixel.y < 260 ? -30 : 140) : (pixel.y < 120 ? -24 : 48)];
    const previous = resultsMarker.options.icon?.options.iconAnchor;
    if (!previous || anchor.some((value, index) => value !== previous[index])) {
      resultsMarker.setIcon(L.divIcon({ className: 'pin-results-marker', html: pinResultsHTML, iconSize: [210, 72], iconAnchor: anchor }));
      bindPinAction();
    }
  }

  function placeFieldPin(latlng, unsaved = true) {
    if (!inRegion(latlng)) {
      if (fieldMarker && lastFieldPoint) fieldMarker.setLatLng(lastFieldPoint);
      setStatus(regionMessage);
      return false;
    }
    lastFieldPoint = L.latLng(latlng);
    if (!fieldMarker) {
      fieldMarker = L.marker(latlng, { icon: fieldIcon, draggable: true, title: 'Field pin: drag to change location', keyboard: true }).addTo(map);
      fieldMarker.on('dragend', () => {
        userMovedMap = true;
        placeFieldPin(fieldMarker.getLatLng());
      });
      fieldMarker.on('click', () => viewFieldResults());
    } else fieldMarker.setLatLng(latlng);
    if (!resultsMarker) {
      resultsMarker = L.marker(latlng, { icon: L.divIcon({ className: 'pin-results-marker', html: pinResultsHTML, iconSize: [210, 72], iconAnchor: [-25, 48] }),
        keyboard: false, interactive: true, zIndexOffset: 500 });
      resultsMarker.on('add', bindPinAction).addTo(map);
    } else resultsMarker.setLatLng(latlng);
    if (unsaved) {
      candidate = L.latLng(latlng);
      saveButton.disabled = savePending;
      pinState.textContent = 'Unsaved pin';
      localize(pinState);
      setStatus(`Selected ${candidate.lat.toFixed(5)}, ${candidate.lng.toFixed(5)}. Save to set your field location.`);
      document.dispatchEvent(new CustomEvent('field-location-selected', { detail: { latitude: candidate.lat, longitude: candidate.lng } }));
    }
    positionResultsMarker(); updateResultButtons();
    return true;
  }
  if (hasSavedPin) placeFieldPin([config.latitude, config.longitude], false);
  else {
    pinState.textContent = 'Choose a field pin'; localize(pinState);
    if (config.outside_region) setStatus('Your saved pin is outside the supported countries. Choose a new field pin.');
  }
  updateResultButtons();
  map.on('move zoom resize', positionResultsMarker);

  map.on('dragstart zoomstart', event => { if (event.originalEvent || event.type === 'dragstart') userMovedMap = true; });
  map.on('explorer-navigation', () => { userMovedMap = true; });
  document.addEventListener('street-view-picking', event => { streetViewPicking = Boolean(event.detail?.active); });
  map.on('click', event => {
    if (savePending) return;
    userMovedMap = true;
    const point = event.latlng.wrap();
    if (streetViewPicking) {
      if (!inRegion(point)) { setStatus(regionMessage); return; }
      streetViewPicking = false;
      document.dispatchEvent(new CustomEvent('street-view-point', {detail:{latitude:point.lat,longitude:point.lng}}));
      return;
    }
    placeFieldPin(point);
  });
  let tileWarningShown = false;
  satellite.on('tileerror', () => {
    if (!tileWarningShown) {
      tileWarningShown = true;
      setStatus('Some satellite tiles could not load. Check your internet connection or zoom out.');
    }
  });

  function locate(forceCenter = false) {
    const requestId = ++locationRequest;
    if (!navigator.geolocation || !window.isSecureContext) {
      setStatus('Device location needs HTTPS or localhost. Click the map or enter coordinates to choose your field.');
      return;
    }
    setStatus('Finding your location... Allow location access in your browser.');
    navigator.geolocation.getCurrentPosition(position => {
      if (requestId !== locationRequest) return;
      const point = L.latLng(position.coords.latitude, position.coords.longitude);
      if (!inRegion(point)) {
        setStatus('Your device is outside the supported countries. Choose your field on the map.');
        return;
      }
      if (!locationMarker) {
        locationMarker = L.circleMarker(point, { radius: 7, color: '#fff', weight: 3, fillColor: '#3285dd', fillOpacity: 1 }).addTo(map);
        locationMarker.bindTooltip('Your device location');
        accuracyCircle = L.circle(point, { radius: position.coords.accuracy, color: '#3285dd', fillOpacity: .08, weight: 1 }).addTo(map);
      } else {
        locationMarker.setLatLng(point);
        accuracyCircle.setLatLng(point).setRadius(position.coords.accuracy);
      }
      if (forceCenter || !userMovedMap) {
        map.setView(point, position.coords.accuracy > 2000 ? 12 : 16);
      }
      // A device position is not automatically a saved farm location.
      if (!hasSavedPin && !candidate) placeFieldPin(point);
      setStatus(`Your location found (accuracy about ${Math.round(position.coords.accuracy)} m). Click your field and save its pin.`);
    }, error => {
      if (requestId !== locationRequest) return;
      const reason = error.code === 1 ? 'Location permission was denied.' : error.code === 3 ? 'Location request timed out.' : 'Your device location is unavailable.';
      setStatus(`${reason} ${hasSavedPin ? 'Showing your saved field.' : 'Click the map or enter coordinates to choose your field.'}`);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }
  document.getElementById('reset-map').addEventListener('click', () => locate(true));
  document.getElementById('show-region').addEventListener('click', () => {
    userMovedMap = true;
    map.fitBounds(regionBounds, { padding: [16, 16], maxZoom: 6 });
    setStatus(regionMessage);
  });
  document.getElementById('zoom-in').addEventListener('click', () => { userMovedMap = true; map.zoomIn(); });
  document.getElementById('zoom-out').addEventListener('click', () => { userMovedMap = true; map.zoomOut(); });
  document.getElementById('coordinate-form').addEventListener('submit', event => {
    event.preventDefault();
    if (savePending) return;
    const latitude = Number(document.getElementById('manual-latitude').value);
    const longitude = Number(document.getElementById('manual-longitude').value);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
    userMovedMap = true;
    const error = document.getElementById('coordinate-error');
    error.hidden = inRegion([latitude, longitude]);
    if (!error.hidden) { localize(error); return; }
    if (!placeFieldPin([latitude, longitude])) return;
    map.setView([latitude, longitude], 16);
    document.getElementById('location-dialog').close();
  });
  document.getElementById('coordinate-form').addEventListener('input', () => {
    document.getElementById('coordinate-error').hidden = true;
  });
  async function saveLocation() {
    if (!candidate || savePending) return !candidate && hasSavedPin;
    const selected = { lat: candidate.lat, lng: candidate.lng };
    savePending = true;
    saveButton.disabled = true;
    fieldMarker.dragging.disable();
    updateResultButtons();
    const body = new URLSearchParams({ action: 'location', latitude: selected.lat.toFixed(7), longitude: selected.lng.toFixed(7) });
    try {
      const response = await fetch('/', { method: 'POST', body, headers: { 'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]').value } });
      if (!response.ok) throw new Error('Save failed');
      const saved = await response.json();
      hasSavedPin = true;
      pinState.textContent = 'Pin saved';
      localize(pinState);
      setStatus(`Field location saved: ${saved.latitude.toFixed(5)}, ${saved.longitude.toFixed(5)}.`);
      candidate = null;
      Object.assign(config, saved);
      document.dispatchEvent(new CustomEvent('field-location-saved', { detail: saved }));
      return true;
    } catch {
      setStatus('Could not save your field location. Your pin is still here; please try again.');
      return false;
    } finally {
      savePending = false;
      saveButton.disabled = candidate === null;
      fieldMarker.dragging.enable();
      updateResultButtons();
    }
  }
  saveButton.addEventListener('click', saveLocation);
  async function viewFieldResults(detail = {}) {
    if (savePending) return;
    if (!candidate && !hasSavedPin) { setStatus(regionMessage); return; }
    if (candidate && !await saveLocation()) return;
    document.dispatchEvent(new CustomEvent('field-results-ready', { detail: {
      tab: detail.tab || 'crops', target: detail.target, latitude: config.latitude, longitude: config.longitude,
    } }));
  }
  document.addEventListener('field-results-request', event => viewFieldResults(event.detail));

  const panel = document.getElementById('map');
  const legend = document.getElementById('layer-legend');
  // Remove the retired control from HTML cached by older development servers.
  document.querySelector('[data-layer="vegetation"]')?.remove();
  document.querySelectorAll('[data-layer]').forEach(button => button.addEventListener('click', () => {
    const selectedLayer = button.dataset.layer;
    document.querySelectorAll('[data-layer]').forEach(tab => {
      tab.classList.toggle('selected', tab === button);
      tab.setAttribute('aria-pressed', String(tab === button));
    });
    panel.classList.toggle('rainfall', selectedLayer === 'rainfall');
    legend.hidden = selectedLayer === 'satellite';
    if (selectedLayer === 'rainfall') {
      legend.textContent = 'Demo tint only: no measured rainfall layer is connected.';
      localize(legend);
    }
  }));
  let lastWidth=0, lastHeight=0, resizeFrame;
  new ResizeObserver(entries => {
    const {width,height}=entries[0].contentRect;
    const nextWidth=Math.round(width), nextHeight=Math.round(height);
    if(nextWidth===lastWidth && nextHeight===lastHeight)return;
    lastWidth=nextWidth;lastHeight=nextHeight;
    cancelAnimationFrame(resizeFrame);
    resizeFrame=requestAnimationFrame(()=>{
      map.invalidateSize({pan:false});
      map.setMinZoom(map.getBoundsZoom(regionBounds, false, L.point(32, 32)));
      map.panInsideBounds(regionBounds.pad(.025), { animate: false });
    });
  }).observe(document.getElementById('live-map'));
  document.dispatchEvent(new CustomEvent('field-map-ready', {detail:{map,region,point:lastFieldPoint}}));
  locate();
})();
