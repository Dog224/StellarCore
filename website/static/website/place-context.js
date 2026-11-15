/* Place context follows the saved pin; never use a photograph from an old pin. */
(() => {
  const card = document.getElementById('place-card');
  if (!card) return;
  const byId = id => document.getElementById(id);
  // An already-running no-reload server may still render the original header.
  // Upgrade that markup as well, without stopping a session-only Claude server.
  const intro = card.closest('.history-intro');
  if (intro && !intro.querySelector('.history-scene')) {
    const summary = byId('history-heading')?.parentElement;
    const body = card.querySelector('.place-card-body');
    const photo = byId('place-photo-wrap');
    if (summary && body && photo) {
      const scene = document.createElement('div'), location = document.createElement('div');
      const preview = document.createElement('div'), picture = byId('place-photo').cloneNode(false);
      scene.className = 'history-scene'; location.className = 'history-location';
      summary.classList.add('history-summary'); body.classList.add('history-area-details');
      preview.className = 'place-thumbnail-wrap'; preview.id = 'place-thumbnail-wrap';
      preview.hidden = true; preview.setAttribute('aria-hidden', 'true');
      picture.id = 'place-thumbnail'; picture.alt = ''; picture.removeAttribute('src');
      preview.append(picture); scene.append(photo, summary); location.append(preview, body);
      card.replaceChildren(scene, location); card.setAttribute('aria-labelledby', 'history-heading');
      intro.replaceChildren(card);
      // Cached HTML also has the old CSS URL. Fetch the matching layout once.
      const stylesheet = [...document.querySelectorAll('link[rel=stylesheet]')].find(link => new URL(link.href).pathname.endsWith('/website/style.css'));
      if (stylesheet) { const url = new URL(stylesheet.href); url.searchParams.set('v', '22'); stylesheet.href = url.href; }
    }
  }
  const config = JSON.parse(byId('map-config').textContent);
  const region = JSON.parse(byId('map-region').textContent);
  const image = byId('place-photo'), photoWrap = byId('place-photo-wrap');
  const thumbnail = byId('place-thumbnail'), thumbnailWrap = byId('place-thumbnail-wrap');
  const credit = byId('place-photo-credit'), source = byId('place-source');
  const status = byId('place-status');
  let controller, sequence = 0, dirty = true, loading = false, unsaved = false;
  const localize = () => window.TerraGrowI18n?.refresh(card);
  const make = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
  const link = (text, href) => { const node = make('a', text); node.href = href; node.target = '_blank'; node.rel = 'noopener'; node.dataset.noTranslate = ''; return node; };
  const countryName = () => region.features.find(feature => window.TerraGrowRegion.contains({features: [feature]}, config.latitude, config.longitude))?.properties.name;
  function clearPhoto() {
    photoWrap.hidden = credit.hidden = true;
    image.removeAttribute('src'); image.alt = '';
    if (thumbnail) { thumbnail.removeAttribute('src'); thumbnailWrap.hidden = true; }
    credit.replaceChildren();
  }
  function reset() {
    clearPhoto(); source.replaceChildren();
    const hasPin = config.latitude !== null && config.longitude !== null;
    byId('place-name').textContent = hasPin ? countryName() || '' : '';
    byId('place-coordinates').textContent = hasPin ? `${Number(config.latitude).toFixed(5)}, ${Number(config.longitude).toFixed(5)}` : '';
    status.textContent = hasPin ? 'Open Weather & soil to see this area.' : 'Save a field pin to see its local area.';
    card.dataset.state = 'name'; localize();
  }
  async function load() {
    if (!dirty || loading || unsaved || config.latitude === null || config.longitude === null) return;
    const request = ++sequence;
    const latitude = Number(config.latitude), longitude = Number(config.longitude);
    controller = new AbortController();
    const requestController = controller;
    const timeout = setTimeout(() => requestController.abort(), 12000);
    loading = true; card.setAttribute('aria-busy', 'true');
    status.textContent = 'Finding the local area...'; localize();
    try {
      const response = await fetch('/api/place/', {signal: controller.signal, cache: 'no-store'});
      const data = await response.json();
      if (request !== sequence) return;
      if (!response.ok || Number(data.latitude) !== latitude || Number(data.longitude) !== longitude) throw new Error('Pin changed');
      dirty = false;
      byId('place-name').textContent = data.label || countryName() || '';
      if (data.address?.source_url) source.append(link('OpenStreetMap contributors', data.address.source_url));
      if (data.fetched_at) {
        source.append(' · ', make('span', 'Updated'), ' ', Object.assign(make('time', data.fetched_at.slice(0, 10)), {dateTime: data.fetched_at}));
      }
      status.textContent = data.address_status === 'ok' ? 'Nearest mapped town or district.' : 'Local area name is unavailable. Showing the selected coordinates.';
      if (data.photo?.image_url) {
        const photo = data.photo;
        const picture = new Image(); picture.referrerPolicy = 'no-referrer';
        picture.src = photo.image_url;
        let imageTimer;
        try {
          await Promise.race([picture.decode(), new Promise((_, reject) => { imageTimer = setTimeout(() => reject(new Error('Image timeout')), 12000); })]);
        } catch { picture.src = ''; return; }
        finally { clearTimeout(imageTimer); }
        if (request !== sequence) return;
        image.src = photo.image_url; image.alt = photo.title; image.dataset.noTranslate = '';
        if (thumbnail) { thumbnail.src = photo.image_url; thumbnailWrap.hidden = false; }
        const title = make('strong', photo.title); title.dataset.noTranslate = '';
        const distance = make('span', 'Nearby place');
        const value = make('span', ` · ≈ ${photo.distance_km < .1 ? '<0.1' : photo.distance_km.toFixed(1)} km`); value.dataset.noTranslate = '';
        credit.append(title, distance, value, document.createElement('br'),
          link(photo.author, photo.source_url), ' · ', link(photo.license, photo.license_url),
          make('p', 'Nearby place photograph, not a live view of your pin. Cropped for display.'));
        photoWrap.hidden = credit.hidden = false; card.dataset.state = 'photo';
      }
    } catch (error) {
      if (request !== sequence) return;
      status.textContent = 'Local area name is unavailable. Showing the selected coordinates.';
    } finally {
      clearTimeout(timeout);
      if (request === sequence) { loading = false; card.setAttribute('aria-busy', 'false'); localize(); }
    }
  }
  const start = event => { if (event.detail?.tab === 'weather') load(); };
  document.addEventListener('field-results-tab', start);
  document.addEventListener('field-results-opened', start);
  document.addEventListener('field-location-selected', event => {
    ++sequence; controller?.abort(); loading = false; dirty = true; unsaved = true;
    Object.assign(config, event.detail); reset(); card.setAttribute('aria-busy', 'false');
    status.textContent = 'Save this pin to see its local area.'; localize();
  });
  document.addEventListener('field-location-saved', event => {
    ++sequence; controller?.abort(); loading = false; dirty = true; unsaved = false;
    Object.assign(config, event.detail); reset(); card.setAttribute('aria-busy', 'false');
    if (!byId('results-panel-weather').hidden) load();
  });
  byId('history-refresh').addEventListener('click', () => { if (!loading) { dirty = true; reset(); load(); } });
  reset();
})();
