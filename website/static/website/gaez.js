(() => {
  const section = document.getElementById('gaez-explorer');
  const grid = document.getElementById('gaez-themes');
  const status = document.getElementById('gaez-status');
  const refresh = document.getElementById('gaez-refresh');
  const advanced = document.getElementById('gaez-advanced');
  let catalog, catalogLoading = false, started = false, unsaved = false;
  let active = 0;
  const jobs = [];
  const cards = [];
  const localize = element => window.TerraGrowI18n?.refresh(element);
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function pump() {
    while (active < 2 && jobs.length) {
      const job = jobs.shift();
      active++;
      job().finally(() => { active--; pump(); });
    }
    refresh.disabled = active > 0 || jobs.length > 0;
  }
  function clear(card, message) {
    card.value.textContent = '\u2014';
    card.note.textContent = message;
    card.details.replaceChildren();
    localize(card.article);
  }
  function controls(card) {
    const layer = catalog.layers.find(item => item.id === card.layer.value);
    card.dimensions.replaceChildren();
    for (const dimension of layer.dimensions) {
      const wrapper = element('div');
      const select = element('select');
      select.name = 'dim_' + dimension.code;
      select.id = `gaez-${card.theme}-${dimension.code}`;
      if (dimension.code.startsWith('CROP')) {
        const prompt = element('option', 'Choose an available crop');
        prompt.value = '';
        select.append(prompt);
      }
      for (const [value, caption] of Object.entries(dimension.options)) {
        const option = element('option', caption);
        option.value = value;
        select.append(option);
      }
      select.value = layer.selection[dimension.code] || '';
      const label = element('label', dimension.label);
      label.htmlFor = select.id;
      wrapper.append(label, select);
      card.dimensions.append(wrapper);
    }
    localize(card.article);
  }
  function showResult(card, data) {
    card.note.textContent = data.message || data.limitation;
    if (data.status === 'ok') {
      const number = Number(data.value).toLocaleString(undefined, { maximumFractionDigits: 2 });
      card.value.textContent = data.class_label || (/class/i.test(data.unit) ? `Class code: ${number}` : `${number} ${data.unit}`);
    }
    appendSources(card, data);
    localize(card.article);
  }
  function appendSources(card, data) {
    const facts = element('dl', undefined, 'gaez-facts');
    const add = (label, text) => {
      const term = element('dt', label), value = element('dd', text);
      if (label === 'Source filename') value.dataset.noTranslate = '';
      facts.append(term, value);
    };
    add('Reference period', data.period_note);
    if (data.publication) add('Dataset publication', data.publication);
    for (const [label, value] of Object.entries(data.selection_labels || {})) add(label, value);
    if (data.resolution_degrees) {
      const km = data.resolution_degrees[1] * 111.32;
      add('Grid spacing', `${data.resolution_degrees[0].toFixed(6)}° × ${data.resolution_degrees[1].toFixed(6)}° (~${km.toFixed(1)} km north–south)`);
    }
    if (data.cell_center) add('Sampled cell center', data.cell_center.map(value => value.toFixed(5)).join(', '));
    if (data.retrieved_at) add('Retrieved', new Date(data.retrieved_at).toLocaleString());
    if (data.filename) add('Source filename', data.filename);
    if (data.raw_value !== undefined) add('Stored raster value', String(data.raw_value));
    if (data.scale_factor !== undefined) add('Scale factor', String(data.scale_factor));
    const links = element('div', undefined, 'gaez-links');
    for (const [caption, url] of [['FAO metadata', data.source_url], ['Source GeoTIFF', data.raster_url]]) {
      if (!url) continue;
      const link = element('a', caption);
      link.href = url; link.target = '_blank'; link.rel = 'noopener';
      links.append(link);
    }
    const details = element('details');
    details.append(element('summary', 'Source, dates & settings'), facts, links,
      element('p', 'FAO and IIASA · GAEZ v5 · CC BY 4.0', 'data-note'));
    card.details.append(details);
  }

  function loadCard(card) {
    card.controller?.abort();
    const controller = new AbortController();
    card.controller = controller;
    const sequence = ++card.sequence;
    if (unsaved) { clear(card, 'Save this pin to assess the selected location.'); return; }
    clear(card, 'Loading FAO grid cell...');
    card.article.setAttribute('aria-busy', 'true');
    const query = new URLSearchParams(new FormData(card.form));
    jobs.push(async () => {
      if (controller.signal.aborted) return;
      const timeout = setTimeout(() => controller.abort('timeout'), 35000);
      try {
        const response = await fetch('/api/gaez/point/?' + query, { signal: controller.signal, cache: 'no-store' });
        const data = await response.json();
        if (sequence !== card.sequence || unsaved) return;
        showResult(card, data);
      } catch (error) {
        if (sequence !== card.sequence || unsaved) return;
        if (controller.signal.aborted && controller.signal.reason !== 'timeout') return;
        clear(card, 'FAO data is unavailable or timed out. You can retry this theme.');
      } finally {
        clearTimeout(timeout);
        if (sequence === card.sequence) card.article.setAttribute('aria-busy', 'false');
      }
    });
    pump();
  }
  function build() {
    grid.replaceChildren();
    for (const [theme, title] of Object.entries(catalog.themes)) {
      const article = element('article', undefined, 'gaez-theme');
      const head = element('div', undefined, 'gaez-theme-heading');
      head.append(element('span', `0${theme}`, 'gaez-number'), element('h3', title));
      const form = element('form', undefined, 'gaez-theme-form');
      const select = element('select');
      select.name = 'layer'; select.id = 'gaez-layer-' + theme;
      const label = element('label', 'Indicator'); label.htmlFor = select.id;
      const layers = catalog.layers.filter(layer => String(layer.theme) === theme);
      for (const layer of layers) { const option = element('option', layer.title); option.value = layer.id; select.append(option); }
      select.value = layers.some(layer => layer.id === catalog.defaults[theme]) ? catalog.defaults[theme] : layers[0].id;
      const dimensions = element('div', undefined, 'gaez-dimensions');
      const button = element('button', 'Load this theme →', 'green-button'); button.type = 'submit';
      form.append(label, select, dimensions, button);
      const value = element('strong', '\u2014', 'gaez-value');
      const note = element('p', '', 'gaez-note'); note.setAttribute('role', 'status');
      const details = element('div', undefined, 'gaez-result-details');
      article.append(head, form, value, note, details);
      grid.append(article);
      const card = {theme, article, form, layer: select, dimensions, value, note, details, sequence: 0};
      cards.push(card);
      controls(card);
      select.addEventListener('change', () => { controls(card); loadCard(card); });
      form.addEventListener('submit', event => { event.preventDefault(); loadCard(card); });
      loadCard(card);
    }
    status.textContent = 'All six GAEZ themes are connected. Choose crops and settings per theme; missing data is never a suitability verdict.';
    localize(section);
  }
  async function start() {
    if (catalogLoading) return;
    started = true;
    if (catalog) { cards.forEach(loadCard); return; }
    catalogLoading = true;
    refresh.disabled = true;
    status.textContent = 'Loading the FAO GAEZ catalogue...';
    localize(status);
    try {
      const response = await fetch('/api/gaez/catalog/');
      if (!response.ok) throw new Error('Catalogue unavailable');
      catalog = await response.json();
      build();
    } catch {
      status.textContent = 'The FAO catalogue could not load. Please retry.';
      localize(status);
    } finally { catalogLoading = false; refresh.disabled = active > 0 || jobs.length > 0; }
  }
  refresh.addEventListener('click', start);
  advanced.addEventListener('toggle', () => { if (advanced.open && !started) start(); });
  document.addEventListener('field-location-selected', () => {
    unsaved = true;
    cards.forEach(card => { card.controller?.abort(); card.sequence++; card.article.setAttribute('aria-busy', 'false'); clear(card, 'Save this pin to assess the selected location.'); });
  });
  document.addEventListener('field-location-saved', () => { unsaved = false; if (started && advanced.open) start(); });
})();
