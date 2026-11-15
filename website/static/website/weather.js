(() => {
  const card = document.getElementById('insights');
  const status = document.getElementById('weather-status');
  const period = document.getElementById('weather-period');
  const refresh = document.getElementById('weather-refresh');
  const details = document.getElementById('weather-details');
  const days = document.getElementById('weather-days');
  const soilNote = document.getElementById('weather-soil-note');
  const soilSurface = document.getElementById('weather-soil-surface');
  const soilRoot = document.getElementById('weather-soil-root');
  const imergTotal = document.getElementById('imerg-total');
  const imergStatus = document.getElementById('imerg-status');
  const assessmentForm = document.getElementById('assessment-form');
  const assessmentBadge = document.getElementById('assessment-badge');
  const assessmentSummary = document.getElementById('assessment-summary');
  const assessmentChecks = document.getElementById('assessment-checks');
  const assessmentSources = document.getElementById('assessment-sources');
  const localizeUpdates = () => {
    window.TerraGrowI18n?.refresh(card);
    window.TerraGrowI18n?.refresh(document.getElementById('planting-check'));
  };
  function renderAssessment(assessment) {
    assessmentChecks.replaceChildren();
    assessmentSources.replaceChildren();
    assessmentBadge.textContent = assessment?.title || 'Save a pin and load weather first';
    assessmentBadge.dataset.state = assessment?.status || 'unavailable';
    assessmentSummary.textContent = assessment ? `Crop: ${assessment.crop}` : 'Save a pin and load weather first';
    document.getElementById('assessment-limitations').textContent = assessment?.limitations || '';
    for (const check of assessment?.checks || []) {
      const item = document.createElement('li');
      item.dataset.state = check.state;
      const heading = document.createElement('strong');
      heading.textContent = check.label;
      const text = document.createElement('p');
      text.textContent = check.detail;
      item.append(heading, text);
      assessmentChecks.append(item);
    }
    for (const source of assessment?.sources || []) {
      const link = document.createElement('a');
      link.href = source.url;
      link.textContent = source.title;
      link.target = '_blank';
      link.rel = 'noopener';
      assessmentSources.append(link);
    }
  }
  const formatSoil = (value, kind) => value === null || value === undefined ? 'Unavailable' :
    kind === 'volumetric' ? `${value.toFixed(3)} m³/m³` : `${value.toFixed(2)} / 1`;
  let controller;
  let sequence = 0;
  let pinUnsaved = false;
  const formatDate = value => new Date(value + 'T00:00:00Z').toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
  function clearReadings() {
    ['rainfall', 'temperature', 'humidity', 'wind'].forEach(name => {
      document.getElementById(`weather-${name}`).textContent = '\u2014';
    });
    period.textContent = '';
    details.hidden = true;
    days.replaceChildren();
    soilSurface.textContent = soilRoot.textContent = '\u2014';
    soilNote.textContent = 'Loading soil data...';
    imergTotal.textContent = '\u2014';
    imergStatus.textContent = 'Loading IMERG rainfall...';
    renderAssessment(null);
    assessmentBadge.textContent = 'Loading field assessment...';
  }
  async function loadWeather() {
    const current = ++sequence;
    controller?.abort();
    controller = new AbortController();
    clearReadings();
    if (pinUnsaved) {
      status.textContent = 'Save this pin to assess the selected location.';
      soilNote.textContent = status.textContent;
      imergStatus.textContent = status.textContent;
      renderAssessment(null);
      assessmentBadge.textContent = status.textContent;
      card.setAttribute('aria-busy', 'false');
      refresh.disabled = false;
      localizeUpdates();
      return;
    }
    card.setAttribute('aria-busy', 'true');
    refresh.disabled = true;
    status.textContent = 'Loading NASA weather for your saved field...';
    localizeUpdates();
    try {
      const query = new URLSearchParams(new FormData(assessmentForm));
      const response = await fetch('/api/weather/?' + query, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Weather request failed');
      const weather = await response.json();
      if (current !== sequence) return;
      renderAssessment(weather.assessment);
      if (weather.status !== 'ok') {
        status.textContent = weather.message;
        soilNote.textContent = weather.status === 'needs_location' ? 'Save your field pin to load soil data.' : 'Soil data is temporarily unavailable.';
        imergStatus.textContent = weather.status === 'needs_location' ? 'Save a field pin to load IMERG rainfall.' : 'IMERG rainfall is unavailable. No estimate was invented.';
        return;
      }
      const imerg = weather.imerg;
      if (imerg?.status === 'ok' || imerg?.status === 'stale') {
        imergTotal.textContent = `${imerg.rainfall_mm.toFixed(1)} mm / 7 days`;
        imergStatus.textContent = `${imerg.period_start} \u2013 ${imerg.period_end} (UTC). ${imerg.status === 'stale' ? 'Older archive data; do not treat as current rainfall.' : 'Latest complete IMERG week retrieved.'}`;
      } else imergStatus.textContent = 'IMERG rainfall is unavailable. POWER rainfall remains shown above.';
      const soil = weather.soil_moisture;
      if (soil?.status === 'ok') {
        soilSurface.textContent = formatSoil(soil.surface, soil.kind);
        soilRoot.textContent = formatSoil(soil.root_zone, soil.kind);
        const kind = soil.kind === 'volumetric' ? 'Volumetric water content' : 'Model wetness index (0 dry, 1 saturated)';
        soilNote.textContent = `${kind} · ${soil.date} (UTC) · NASA POWER`;
      } else {
        soilSurface.textContent = soilRoot.textContent = 'Unavailable';
        soilNote.textContent = 'No valid soil data is available for this location and period.';
      }
      document.getElementById('weather-rainfall').textContent = `${weather.rainfall_mm.toFixed(1)} mm`;
      document.getElementById('weather-temperature').textContent = `${weather.temperature_c.toFixed(1)} \u00b0C`;
      document.getElementById('weather-humidity').textContent = weather.humidity_percent === null ? 'Unavailable' : `${weather.humidity_percent.toFixed(1)}%`;
      document.getElementById('weather-wind').textContent = weather.wind_ms === null || weather.wind_ms === undefined ? 'Unavailable' : `${weather.wind_ms.toFixed(2)} m/s`;
      period.textContent = `${formatDate(weather.period_start)} \u2013 ${formatDate(weather.period_end)} (UTC)`;
      status.textContent = `Saved pin ${weather.latitude.toFixed(4)}, ${weather.longitude.toFixed(4)}. Historical 7-day summary.`;
      for (const day of weather.days) {
        const row = document.createElement('tr');
        for (const value of [formatDate(day.date), day.temperature_c.toFixed(1),
          day.minimum_c?.toFixed(1) ?? '\u2014', day.maximum_c?.toFixed(1) ?? '\u2014', day.wind_ms?.toFixed(2) ?? '\u2014',
          day.rainfall_mm.toFixed(2), day.humidity_percent === null ? '\u2014' : day.humidity_percent.toFixed(1),
          day.soil?.status === 'ok' ? formatSoil(day.soil.surface, day.soil.kind) : '\u2014',
          day.soil?.status === 'ok' ? formatSoil(day.soil.root_zone, day.soil.kind) : '\u2014']) {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.append(cell);
        }
        days.append(row);
      }
      document.getElementById('weather-fetched').textContent = `Retrieved ${new Date(weather.fetched_at).toLocaleString()}. Cached for up to 6 hours.`;
      details.hidden = false;
    } catch (error) {
      if (current !== sequence || error.name === 'AbortError') return;
      status.textContent = 'Could not load NASA data. Check your connection and try again.';
      soilNote.textContent = 'Soil data is temporarily unavailable.';
      imergStatus.textContent = 'IMERG rainfall is unavailable. No estimate was invented.';
      renderAssessment(null);
    } finally {
      if (current === sequence) {
        card.setAttribute('aria-busy', 'false');
        refresh.disabled = false;
        localizeUpdates();
      }
    }
  }
  let started = false;
  refresh.addEventListener('click', () => { started = true; loadWeather(); });
  assessmentForm.addEventListener('submit', event => { event.preventDefault(); loadWeather(); });
  document.addEventListener('field-location-saved', () => {
    pinUnsaved = false;
    document.getElementById('assessment-ph').value = '';
    document.getElementById('assessment-drainage').value = 'unknown';
    document.getElementById('assessment-water').value = 'unknown';
    if (started) loadWeather();
  });
  document.addEventListener('field-location-selected', () => { pinUnsaved = true; if (started) loadWeather(); });
  const startWeather = event => { if (event.detail?.tab === 'weather' && !started) { started = true; loadWeather(); } };
  document.addEventListener('field-results-opened', startWeather);
  document.addEventListener('field-results-tab', startWeather);
})();
