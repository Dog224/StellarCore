/* One map screen, one accessible results dialog. Existing result nodes are kept
   in place inside tabs so requests, sources and translations remain intact. */
(() => {
  const dialog = document.getElementById('field-results-dialog');
  // Also remove retired controls from an older server's cached HTML.
  dialog.querySelector('#results-tab-vegetation')?.remove();
  dialog.querySelector('#results-panel-vegetation')?.remove();
  const tabs = [...dialog.querySelectorAll('[data-results-tab]')];
  const scrollArea = document.getElementById('results-scroll-area');
  const location = document.getElementById('results-location');
  let lastTrigger, activeTab = 'crops';
  const config = JSON.parse(document.getElementById('map-config').textContent);
  const hashTabs = { '#gaez-explorer': 'crops', '#insights': 'weather', '#planting-check': 'weather',
    '#crop-plan': 'crops', '#calendar': 'plan' };
  function showTab(name, focus = false) {
    if (!tabs.some(tab => tab.dataset.resultsTab === name)) name = 'crops';
    activeTab = name;
    for (const tab of tabs) {
      const selected = tab.dataset.resultsTab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
      if (selected && focus) tab.focus();
    }
    scrollArea.scrollTop = 0;
    document.dispatchEvent(new CustomEvent('field-results-tab', { detail: { tab: name } }));
  }
  function open(detail = {}) {
    if (!dialog.open) {
      lastTrigger = document.activeElement;
      document.querySelectorAll('dialog[open]').forEach(other => other.close());
      showTab(detail.tab || 'crops');
      dialog.showModal();
      document.documentElement.classList.add('results-open');
      dialog.querySelector('.results-close').focus({ preventScroll: true });
    } else showTab(detail.tab || activeTab);
    const latitude = detail.latitude ?? config.latitude, longitude = detail.longitude ?? config.longitude;
    location.textContent = latitude !== null && longitude !== null ? `${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}` : '';
    window.TerraGrowI18n?.refresh(dialog);
    document.dispatchEvent(new CustomEvent('field-results-opened', { detail: { tab: activeTab } }));
    if (['#calendar', '#crop-plan'].includes(detail.target)) requestAnimationFrame(() => document.querySelector(detail.target).scrollIntoView({ block: 'nearest' }));
  }
  function request(tab = 'crops', target) {
    document.dispatchEvent(new CustomEvent('field-results-request', { detail: { tab, target } }));
  }
  document.addEventListener('field-results-ready', event => open(event.detail));
  document.addEventListener('field-location-saved', event => {
    if (event.detail) Object.assign(config, event.detail);
  });
  document.querySelectorAll('[data-field-results-trigger]').forEach(button => button.addEventListener('click', () => request()));
  document.querySelectorAll('[data-results-target]').forEach(button => button.addEventListener('click', () => {
    const target = button.dataset.resultsTarget;
    if (target === '#crop-plan') { showTab('crops'); document.querySelector(target).scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}); }
  }));
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => showTab(tab.dataset.resultsTab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
        (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      showTab(tabs[next].dataset.resultsTab, true);
    });
  });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')]
      .filter(node => {
        if (node.tabIndex < 0 || !node.getClientRects().length || node.closest('[hidden]') || getComputedStyle(node).visibility === 'hidden') return false;
        // Descendants of collapsed details can still have layout rectangles in
        // Chromium. Only each collapsed details element's own summary is tabbable.
        for (let parent = node.parentElement; parent && parent !== dialog; parent = parent.parentElement) {
          if (parent.tagName === 'DETAILS' && !parent.open && node !== parent.querySelector(':scope > summary')) return false;
        }
        return true;
      });
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    document.documentElement.classList.remove('results-open');
    if (hashTabs[window.location.hash]) history.replaceState(null, '', window.location.pathname + window.location.search + '#map');
    const trigger = lastTrigger?.isConnected && !lastTrigger.disabled && lastTrigger !== document.body ? lastTrigger : document.getElementById('view-field-results') || document.querySelector('.sidebar nav a[href="#gaez-explorer"]');
    requestAnimationFrame(() => { if (!document.querySelector('dialog[open]')) trigger?.focus({ preventScroll: true }); });
    document.querySelectorAll('.sidebar nav a').forEach(link => {
      const home = link.getAttribute('href') === '/map/';
      link.classList.toggle('active', home);
      if (home) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
  });
  document.querySelectorAll('.sidebar nav a').forEach(link => link.addEventListener('click', event => {
    const hash = link.getAttribute('href');
    if (hashTabs[hash]) {
      event.preventDefault();
      history.replaceState(null, '', window.location.pathname + window.location.search + hash);
      request(hashTabs[hash], hash);
    } else if (hash === '#map' && dialog.open) dialog.close();
  }));
  const routeHash = () => { if (hashTabs[window.location.hash]) request(hashTabs[window.location.hash], window.location.hash); };
  window.addEventListener('hashchange', routeHash);
  // DOMContentLoaded waits for every deferred map/provider script, including on
  // slow connections. A timer could fire before those scripts attach handlers.
  const initialRoute = () => { if (!document.querySelector('dialog[data-open]')) routeHash(); };
  if (document.readyState === 'complete') initialRoute();
  else window.addEventListener('DOMContentLoaded', initialRoute, { once: true });
})();
