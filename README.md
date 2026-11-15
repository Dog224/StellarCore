# MekongRise - Django farm dashboard

A responsive farming dashboard for Laos and the Mekong region, built with Python, Django, HTML, CSS and JavaScript. No separate frontend server or Node build is needed.

The project includes a satellite map, location-based crop screening, weather history, planting plans, market reference prices, English/Thai/Lao interfaces, and the optional Claude-powered Orbee assistant.

This repository contains source code and bundled public reference data. Local accounts, saved fields and events, API keys, development secrets, downloaded caches and private design documents are excluded. `migrate` creates a new local database. For Orbee, copy `.env.example` to `.env` beside `manage.py` and set your own `ANTHROPIC_API_KEY` there; never commit `.env`.

The globe button beside Sign in/Profile switches the dashboard between English, Thai, and Lao. The selection is saved in this browser's local storage and applies to cards, dialogs, calendar labels, and incoming map/weather messages. User-entered field names, event titles, and form values are preserved. The Django admin is a separate interface. Translation entries are maintained in `website/static/website/language.js`; proper names, imagery attribution, and units retain their original text.

## Start (PowerShell)

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py runserver
```

Open http://127.0.0.1:8000/.

## Connected features

- Edit or Settings opens the field form. Field size, name, crop rotation, planting date, and growing period persist in SQLite.
- The crop card and timeline read the saved field. Estimated harvest is planting date plus growing period.
- Click a calendar date or Add a farm event to save an event. Month arrows navigate the actual calendar; View All lists that month's events and lets you mark them complete.
- The real satellite map uses Leaflet 1.9.4 and Esri World Imagery tiles. It requests device location on startup; the locate button retries. Zoom and pan navigate real geographic imagery.
- Click the map, drag the field marker, or enter coordinates, then use Save field pin to persist its latitude/longitude to Django. The blue circle shows device position and accuracy; it is distinct from the field pin. Device location is not saved automatically.
- `/api/dashboard/` returns field/event data and the NASA weather endpoint URL.
- `/api/weather/` retrieves real NASA POWER daily temperature (`T2M`), corrected rainfall (`PRECTOTCORR`), and relative humidity (`RH2M`) for the saved field pin. The overview loads asynchronously and refreshes automatically when a pin is saved.
- The overview shows the latest complete seven-day period found within the last 35 days of the request, ending at least two days ago. Rainfall is a seven-day total; temperature and humidity are seven-day means. Expand View daily readings to inspect the actual dates and daily values.
- Django admin manages fields, events, and the original contact-message records. The original contact records are preserved; the homepage is now the dashboard.

The initial migration creates a starter field with a planting date two weeks ahead. Dates and calendar calculations use Asia/Bangkok.

## Admin

```powershell
.\.venv\Scripts\python.exe manage.py createsuperuser
```

Visit http://127.0.0.1:8000/admin/.

## Verify

```powershell
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py test
```

Optional browser smoke check (requires installed Google Chrome and Node, with Django running):

```powershell
node tools/preview-check.mjs
```

This checks desktop/mobile layout, real satellite tile loading, map tabs, dialogs, calendar date selection, manual coordinates, and allowed/denied location access. Device coordinates are simulated for QA and are not saved to the database. Screenshots are written to a temporary directory.

## Data and deployment

This is a local, single-user workspace. Dashboard edits are available to anyone who can access the server. Add authentication and per-user ownership before exposing it publicly. Django admin already requires login. Forms use CSRF protection and server-side validation.

The satellite map is connected to Esri World Imagery; it requires internet access and shows available imagery, not a live camera feed. Leaflet is bundled locally with its license. No API key is required for the configured tile endpoint. Device location uses browser geolocation, requires Allow permission, and works over HTTPS or localhost (plain HTTP on a LAN IP generally cannot access location). Location accuracy depends on your device; when denied or unavailable, a saved field pin is shown, or you can choose a point manually. An unsaved device location stays in the browser; map tiles are requested from Esri for the viewed area. Field coordinates are sent to Django only when Save field pin is clicked.

NASA POWER is connected server-side with Python standard-library HTTP requests; no additional package or API key is needed. The request uses the saved field coordinates rounded to four decimals, `community=AG`, and UTC dates. Saving a pin and loading the overview sends these coordinates to NASA POWER to obtain readings. Successful responses are cached for six hours per coordinate/day; failures are cached for two minutes to avoid repeated requests. The default Django cache is per process and resets on server restart. Refresh readings reuses the cache while valid.

The displayed values are regional gridded estimates with publication lag, not live farm sensors or a forecast. Missing data is never counted as zero rainfall: a full consecutive seven-day temperature/rainfall period is required; incomplete humidity shows Unavailable. If no pin is saved, the card asks for one. API/network failures show an unavailable message and no invented fallback readings.

The Soil Moisture section refreshes alongside weather after Save field pin. NASA POWER requests now include `SFMC`, `RZMC`, `GWETTOP`, and `GWETROOT`. Valid volumetric surface/root-zone content is displayed in m³/m³ when provided. Otherwise, valid `GWETTOP`/`GWETROOT` model wetness indices are displayed on their original 0–1 scale, labeled as indices (0 dry, 1 saturated). These are not soil-water percentages or claimed SMAP sensor readings. Soil values have their own latest valid date within the requested window, up to the weather period end. Each daily table row also shows the available soil values with units; missing soil does not suppress valid weather readings. The live POWER service currently returns missing volumetric fields at the saved Laos pin, so the dashboard uses the labeled model-index fallback there. Credentials for direct SMAP Earthdata downloads are not configured.

Rainfall/vegetation map overlays are still explicitly labeled demo tints; NASA point readings do not turn them into measured spatial layers. No field boundary or crop recommendation is inferred. Crop selection remains manually editable, and harvest estimates use the saved growing period.

SQLite is stored in ignored `db.sqlite3`. Development uses an ignored persistent `.secret_key`. For production set `DJANGO_DEBUG=false`, `DJANGO_SECRET_KEY`, and comma-separated `DJANGO_ALLOWED_HOSTS`; configure HTTPS, static serving (`collectstatic`), authentication, and a production WSGI/ASGI server.

## Files

- `website/templates/website/home.html`: dashboard template
- `website/static/website/`: CSS, JavaScript, SVG icons, local images
- `website/models.py`: Field and FarmEvent database models
- `website/views.py`: forms, calendar, harvest estimate, JSON endpoint
- `website/forms.py`: server-side validation
- `website/nasa_power.py`: NASA requests, validation, seven-day summaries, caching
- `website/static/website/weather.js`: asynchronous overview updates
- `website/test_nasa_power.py`: isolated NASA integration tests (no network needed)

## Image credits

- Satellite tiles: Esri World Imagery, Maxar, Earthstar Geographics and the GIS User Community; attribution is displayed on the map. The old local aerial image is unused by the interactive map. Source: https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer
- Rice: Graphic Node / Unsplash, https://unsplash.com/photos/pBCQW3rGI3c
- Seedling: Rainier Ridao / Unsplash, https://unsplash.com/photos/Gj6w4IasZY0
- Corn photo: Unsplash, https://images.unsplash.com/photo-1551754655-cd27e38d2076

Crop photos illustrate the interface and do not change when the saved crop names change.

## NASA integration verification

Django tests mock external responses to cover valid readings, zero rainfall, missing values, wrong units, timeouts, caching, changed locations, and the weather endpoint. The browser smoke checker optionally accepts `--weather-fixture <absolute-json-file>` containing a successful `/api/weather/` response; this checks rendering, unavailable states, and automatic reload after a saved-location event without changing the real database. Normal browser QA runs without that argument.

NASA source and API documentation: https://power.larc.nasa.gov/ and https://power.larc.nasa.gov/docs/services/api/temporal/daily/

## IMERG and crop screening

The existing NASA POWER request also requests `IMERG_PRECTOT` in UTC. The 100-day lookback can recover an older complete IMERG week when recent IMERG data is missing. The normal weather summary still searches only its most recent 35 days. IMERG is displayed separately with its own dates, total, source, and roughly 10 km grid. A complete IMERG week ending more than seven days before today is flagged as an older archive and is never silently substituted for current POWER rainfall. Missing days never become zero rainfall. At the saved Laos pin, the current live API returns an archived IMERG week in September; the November POWER readings remain separate.

The Soil & planting check automatically uses the saved pin and planned crop. Rice, maize, and mung bean have documented crop profiles in `website/assessment.py`. Optional measured pH, observed drainage, and planned water control can be supplied in the card; these are session-only observations, not satellite-derived values, and are reset when a new pin is saved. They do not overwrite the saved crop plan. Unsupported crops are explicitly unassessed. Select another crop or update pH/drainage and press Check crop to rerun the screen. The browser uses GET parameters for these optional inputs on `/api/weather/`.

The screen reports potential constraints, more checks needed, or a potential match on the checked factors. It never labels the soil healthy or certifies planting suitability. Weekly air temperature is compared with broad ecological reference ranges only, and is not treated as seedbed soil temperature or a whole-season climate assessment. Nutrients, pH, organic matter, salinity, soil texture and drainage cannot be established from the available pin-based wetness readings. Conditions older than 14 days are excluded from crop screening. These freshness cutoffs are application screening policies, not validated agronomic thresholds. Soil health remains Not determined even when checked factors match.

Selecting an unsaved pin clears the old readings/assessment immediately. Save field pin loads the selected location and resets local soil observations, so results for the previous place do not appear to describe a new pin. NASA sources are regional grids; the pin is an exact coordinate, not a direct measurement of that precise plot. This feature does not supply rain forecasts, irrigation quantities, fertilizer prescriptions, or yield predictions.

Crop references (also linked in the assessment):
- Rice: https://ecocrop.apps.fao.org/ecocrop/srv/en/dataSheet?id=1574
- Maize: https://ecocrop.apps.fao.org/ecocrop/srv/en/dataSheet?id=238663
- Mung bean temperature: https://ecocrop.apps.fao.org/ecocrop/srv/en/dataSheet?id=2150
- Mung bean soil guidance: https://corn.aae.wisc.edu/Crops/Mungbean.aspx
- IMERG via POWER: https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/


## Dynamic crop recommendations

The Crops tab ranks every active `CropProfile` database record against the saved pin. The former fixed four-crop pipeline and `/api/gaez/automatic/` route have been removed. Recommendations do not use the saved crop rotation, default Mung Bean plan, latitude bonuses, popularity, or a fallback list. The saved plan is explicitly labelled separately.

The bundled, sourced catalogue contains 13 profiles: rice, maize, cassava, Arabica coffee, Robusta coffee, banana (Musa acuminata), peanut, soybean, mung bean, tomato, cabbage, cucumber and chilli. Each stores optimal/absolute temperature, annual rainfall, pH and elevation descriptors; categorical texture/drainage; crop-cycle ranges; water references; source URLs, dates/unknown publication dates and source hashes. Unknown descriptors remain null. The crop pictures are original SVG illustrations, not satellite images or photos of the user's farm.

Migrations create and populate the crop table without network access. To refresh reviewed references:

```powershell
.\.venv\Scripts\python.exe tools/sync_crop_profiles.py
.\.venv\Scripts\python.exe manage.py import_crop_profiles
```

The first command fetches official FAO ECOCROP sheets and FAO Irrigation Water Management Training Manual No. 3 Tables 4/5. The second imports the bundled reference JSON into SQLite. The raw reference HTML is cached in ignored `.crop_source_cache/`. `--cached` supports a reproducible rebuild. Reference facts can be inspected in Django admin; additions go through the reviewed import rather than incomplete admin records.

### Location data and provenance

Annual temperature and annual precipitation preferentially use FAO GAEZ v5 / AgERA5, historical 2001-2020, 5 arc-minute grid (about 9 km north-south). Actual source raster filenames, cell centres, source links, units and retrieval timestamps are returned. A complete FAO pair is required; the app never quietly mixes a FAO temperature with NASA annual rainfall.

NASA POWER climatology is an explicitly labelled fallback if the FAO pair is unavailable. The API's actual period is retained from its header (currently the live response reports 2001-2025); no period is hardcoded as current. Monthly daily rainfall rates in mm/day are multiplied by average Gregorian month lengths and summed, not mistaken for monthly or annual totals. Monthly NASA normals are separately sourced inputs to tentative planting windows. They are coarser than GAEZ and can miss mountain climate effects.

Elevation uses SRTM v3 (~90 m, February 2000) through Open Topo Data, not the NASA climate grid's coarser elevation. Soil pH and texture remain unknown without verified local data. Humidity, satellite wetness and greenness are never used as substitutes for soil chemistry or fertility. Missing sources, units, fill values and non-finite data cannot become zero rain or a perfect crop match. Nearby pins may legitimately share climate-grid values; the app does not force artificial differences.

### Scoring and planting estimates

`website/crop_recommendations.py` implements a transparent app screen, not an official FAO ECOCROP/GAEZ model, calibrated yield model or harvest probability. Numeric membership is 100 within the optimal range, tapers linearly to zero at absolute limits, and is zero outside them. An elevation descriptor that reports only a maximum is treated as a binary ceiling; an unreported lower bound or optimum is never invented. Categorical texture uses the published classes if a local texture is available.

Weights are explicit app choices: temperature 40, annual rainfall 35, elevation 10, pH 10 and texture 5. Scores average only factors with both location data and a usable crop reference. Any known zero/absolute constraint forces zero. Both temperature and annual rainfall must be available to rank; failures produce no recommendation. Data coverage is shown separately (typically 3/5 factors), so a score of 100 on available factors does not imply verified suitability. Soil tests can still reveal a decisive constraint. Levels use disclosed app thresholds of 80/60/40. Equal scores share rank; alphabetical order breaks display ties without an extra agronomic preference. Up to three candidates scoring at least 60 appear first; all evaluated crops and reasons are accessible below.

FAO GAEZ crop-specific suitability is an independent, lazy-loaded regional model check in each crop's details. Its 0-100 index is not blended into the EcoCrop range score: doing so only for covered crops would penalize species with a GAEZ layer and hide missing evidence for others. Rain-fed/low-input assumptions, generic coffee-group scope, and the lowland-rice scenario are disclosed. No crop is substituted for mung bean, cucumber or chilli when their matching GAEZ layer is absent.

The FAO seasonal water guide is crop evapotranspiration over the growing period, not irrigation volume or annual rainfall. Unknown water requirements remain unknown. Where compatible FAO duration and water guides exist, a tentative rain-fed start-month screen uses the duration midpoint, monthly temperature within absolute bounds with mean membership at least 80, and gross rainfall at least the lower guide. This deliberately simple screen does not establish effective rain, drainage, rice flooding losses, irrigation, local varieties or a validated Lao planting calendar. Its method, source period and uncertainty are exposed. The next candidate month's first day and sourced duration interval form a conditional harvest interval. If no supported window exists, dates are not invented. Perennial fruit cycles are not confused with planting-to-first-harvest, which remains unestablished without local establishment information.

Each crop includes its name/illustration, level, numeric score, factor readings and optimal/absolute limits, missing factors, water guide, growing period, conditional season/harvest or the reason these cannot be established, and source/date links. The optional field-check form now uses the same database instead of a second hardcoded requirements dictionary.

Routes:

- `/api/crops/recommendations/`: saved-pin environment, all active ranked profiles, candidates, method, provenance and limitations. Arbitrary GET coordinates are ignored; stale responses are rejected if the saved pin changed during reads.
- `/api/crops/gaez/?crop=slug&pin=fingerprint`: matching source crop, explicitly selected rain-fed low-input historical scenario and provenance. No arbitrary URLs or substitute species.

Source responses are cached by exact coordinates, with bounded source reads and short failure caches. Scores are recomputed from the current database; profile changes do not reuse an old ranking. Provider requests wait until the results dialog first opens; pin changes clear and cancel old results before saving/reloading.

### Validation

```powershell
.\.venv\Scripts\python.exe manage.py test
.\.venv\Scripts\python.exe tools/validate_crop_locations.py
node tools/preview-results.mjs
```

The live validator queries actual sources for Vientiane lowlands, Paksong/Bolaven Plateau and Phongsaly highlands. It fails rather than substituting fixture data if the preferred sources are unavailable or distinct environmental values and top-three rankings are not observed. It does not change the saved farm. [reports/crop-location-validation.md](reports/crop-location-validation.md) and its JSON companion preserve the real values, full rankings, requirements and provenance. Unit tests separately cover source parsing/caching, optimal and absolute limits, missing data, zero rain, score ordering/ties, perennials, date estimates, and all three pin updates through the Django API with an isolated test database. Browser QA exercises the actual popup, illustrations, Lao labels, local font loading, save failure/retry, keyboard controls and stale-result cleanup.

Primary references:

- FAO ECOCROP overview and historical status: https://www.fao.org/geospatial/data-and-tools/data-portals/ecocrop/en
- Each species' official sheet is linked in `website/data/crops_ecocrop_v1.json` and its database row.
- FAO seasonal water/duration guidance: https://www.fao.org/4/s2022e/s2022e02.htm
- GAEZ v5 platform: https://github.com/un-fao/gaezv5/wiki/21.-GAEZ-v5-Platform-User-Guide
- NASA POWER climatology: https://power.larc.nasa.gov/docs/services/api/temporal/climatology/
- SRTM service: https://www.opentopodata.org/datasets/srtm/

## FAO GAEZ advanced explorer: all six themes

The optional advanced explorer still exposes 83 baseline indicators across the six GAEZ themes (5 land/water, 45 agro-climatic, 11 climatic potential-yield, 15 suitability/attainable-yield, 4 actual-yield/production and 3 yield-gap indicators). Its selectors are for expert exploration and do not determine the ranked crop list. It loads only when opened and limits browser requests to two at a time. Layer IDs and dimensions are validated against bundled source metadata; bounded HTTP byte ranges retrieve raster cells rather than downloading global rasters. Missing data remains unknown, not zero yield. Source blocks and points are cached for 24 hours and failures for two minutes in ignored `.gaez_cache/`.

`/api/gaez/catalog/` and `/api/gaez/point/` remain available. `tools/sync_gaez_catalog.py` refreshes official catalogue metadata. Source raw values, scale factors, dates, cell centres and resolution remain inspectable. Potential dry-weight yield and historical statistical yield are not directly subtracted or treated as the same measurement. Historical and future scenarios are clearly separate.

## Archived Copernicus Sentinel-2 vegetation integration

Vegetation monitoring has been removed from the app interface at the owner's
request. There is no Vegetation results tab, map layer, NASA NDVI card or
satellite-processing panel, and pages no longer request Copernicus observations.
The following describes the retained backend integration for possible future
reuse; it is not a current user-facing feature. Satellite basemap imagery,
weather, soil moisture and crop suitability continue independently.

The Vegetation around your field card is in the results dialog's Vegetation tab. It starts when the dialog is first opened and subsequently refreshes when a new field pin is saved. It reads real Sentinel-2 L2A observation metadata from the public Copernicus STAC catalogue without an account. The latest satellite pass, tile cloud-cover metadata, and a direct source-observation link are available now. Tile cloud cover is explicitly not treated as cloud cover over the farm, and a pass is not treated as a clear observation.

NDVI statistics and the observed vegetation map use the authenticated Copernicus Sentinel Hub Statistical and Process APIs. Without configured credentials the app clearly says processing is not connected, shows no invented NDVI, and leaves the existing satellite base map visible. The previous vegetation demonstration tint has been removed. Rainfall remains a separately labelled demonstration layer.

One-time developer connection (farmers need no Copernicus account):

1. Register/sign in at https://dataspace.copernicus.eu/ . Open the Sentinel Hub dashboard https://shapps.dataspace.copernicus.eu/ and create a server-side OAuth client under User Settings / OAuth clients. Record its client ID and client secret securely. These must be a Sentinel Hub OAuth client, not S3 credentials.
2. Stop the current Django server with Ctrl+C in its terminal. From the project directory run:

   ```powershell
   .\.venv\Scripts\python.exe manage.py run_copernicus 127.0.0.1:8000
   ```

3. Enter the client ID and secret at the local prompts. The secret is hidden and is not written to a file or passed on the command line. The command verifies token access and starts Django for that session without an auto-reloader. Restarting this command requires entering credentials again. Never paste the secret into browser JavaScript or chat.
4. Refresh the website with Ctrl+F5, save the field pin, and use Show vegetation on map or the Vegetation map tab when a usable observation is available.

Deployments can supply `COPERNICUS_CLIENT_ID` and `COPERNICUS_CLIENT_SECRET` through their server environment and use normal Django startup. Django also loads the project-root private `.env` file; server environment variables take precedence. OAuth access tokens remain in server memory, are reused until shortly before expiration, and never appear in API responses, URLs, logs, or disk caches.

Sampling and interpretation:

- The footprint is approximately 200 m by 200 m around the saved pin, not the recorded farm area or an inferred field boundary. Neighbouring vegetation, roads, and other land may be included. Sentinel-2's red and NIR bands are sampled on an approximately 10 m grid. A real field outline is a future improvement.
- The Statistical API calculates daily land NDVI over the last 60 days. Scene Classification excludes clouds, shadows, water, snow, uncertain/defective pixels and no data. At least 80% of all sampled pixels must be usable land pixels; unusable observations never become zero NDVI. Genuine zero NDVI remains a valid reading. The displayed usable percentage includes all masking causes, not just clouds.
- A trend compares the two most recent usable UTC observation days if no more than 21 days apart. A 0.05 NDVI change is an explicitly disclosed app inspection threshold, not a validated crop-health threshold. One observation produces no trend. Observations older than 21 days are clearly stale and never described as current.
- The dated PNG vegetation overlay uses the same footprint, daily time window, land mask and NDVI formula as the statistics. It is requested only when the farmer opens the map layer. Transparent pixels are excluded observations; colour denotes greenness, not healthy/unhealthy soil. No disease diagnosis, soil chemistry measurement, crop identity, rainfall forecast or harvest prediction is inferred from NDVI.
- Public catalogue and successful statistics/images are cached for six hours in ignored `.copernicus_cache/`; failures are cached for two minutes. HTTP reads and response sizes are bounded. Selecting an unsaved pin immediately clears old readings and overlays. Image requests include a pin fingerprint, so a previous location's URL is rejected after the saved pin changes. No global satellite products are downloaded.

Routes:

- `/api/copernicus/?kind=catalogue`: public observation metadata for the saved pin.
- `/api/copernicus/?kind=vegetation`: authenticated land NDVI statistics, dates, coverage, trend and an image URL when usable data exists.
- `/api/copernicus/image/?pin=...&date=...`: bounded NDVI PNG for a verified observation and current pin. Arbitrary coordinates, external URLs and unverified dates are not accepted.

Verification: backend tests cover masks/coverage, zero and missing readings, stale and duplicated observation days, trend changes, credential/token handling, bounded source contracts, failures, pin isolation and image request validation. `node tools/preview-copernicus.mjs` checks the real public catalogue, the unconfigured state, Lao translation and mobile layout. It separately uses clearly marked synthetic processing responses to test charts, image loading, layer switching, cloud/stale/access failures and pin-change cleanup. No authenticated live NDVI/image verification is claimed until real credentials are supplied.

Primary references:

- STAC catalogue: https://documentation.dataspace.copernicus.eu/APIs/STAC.html
- Statistical API: https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Statistical.html
- Processing examples: https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Process/Examples/S2L2A.html
- OAuth setup: https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/Authentication.html
- Attribution: contains modified Copernicus Sentinel data (observation year), processed by Sentinel Hub.


## Light and dark appearance

The sun/moon button next to the language/account controls switches the home,
results, dialogs and login/signup pages between light and dark palettes. The
choice is saved in this browser under `mekongrise-theme` and applied before
styles load. Without an explicit choice, the operating-system preference is
used; a saved choice takes priority and synchronizes across tabs. Storage
restrictions do not stop the toggle from working for the current page.

`theme.js` changes a root attribute; it does not reload data or invert images.
Satellite tiles, crop photos and location photos keep their original colours.
Native form controls use the matching colour scheme. Buttons have keyboard
support and translated action labels in English, Lao and Thai. Transitions are
short and respect reduced-motion preferences. The pin's results button remains
available after removing the fixed bottom-right duplicate; closing results
restores focus to the surviving pin control or Crop navigation.

`node tools/preview-theme.mjs` checks the system default, keyboard switching,
saved preference across navigation/refresh, desktop/mobile layout, dark results,
readable text contrast, preserved image filters, translated labels and the
remaining pin-result action. It uses an isolated temporary database.

## Home page, sketch version 2

The home workspace at `/map/` uses the supplied sketch: a full-width MekongRise
brand/slogan bar, language selector immediately beside Sign in or Profile, a
quiet left navigation rail, Hello Farmer and the real map in the centre, and
weather/risk summary cards on the right. The mobile layout keeps compact
summaries above the map. `home.css` scopes this presentation to the dashboard;
the farm-background login page and remembered sessions continue to work.

Home returns to the map. Sidebar links now navigate to separate Crop, Market,
NASA data, Alerts and Orbee pages. The map's pin **View results** action still
opens the original four-tab results popup. The home-card Explore alerts action
retains its compact rain/air details dialog. Market opens the supplied spreadsheet's
plant catalogue, dated reference price ranges and regional planting notes,
with USD, Lao kip and Thai baht display options. Live local buying prices are
not connected.
Farm help opens Orbee. Claude replies are available when the server-side API
key is configured; otherwise the page explicitly provides topic-guide replies.

`GET /api/home/conditions/` reads only the current farmer's saved pin, and rejects
responses when that pin changes during a source read. It retrieves current
modelled air temperature, relative humidity and wind at 10 m from Open-Meteo,
and regional PM2.5 plus overall US AQI from CAMS global through Open-Meteo.
The wind card uses km/h; the separate NASA history uses m/s at 2 m. Source dates
are shown in UTC. The PM2.5 estimate represents an approximately 45 km model
cell, not a local sensor. Each source can fail independently without replacing
missing values with sample numbers. Weather older than two hours and air data
older than six hours are labelled as older estimates.

Dry days count the previous seven complete UTC days with modelled rainfall
below 1 mm/day. Every day must have valid precipitation before a count or total
is displayed. Today is excluded. This is a descriptive indicator, not a drought
probability, validated farm warning or irrigation prescription. The details panel
shows its exact period, threshold and source. No example 42-percent risk is used.

The two small provider requests run in parallel with bounded reads. Successful
results are cached for 15 minutes in ignored `.home_cache/`, and partial/failure
results for two minutes. Cards load asynchronously without blocking the map.
Selecting an unsaved pin immediately clears old conditions; viewing results
saves the pin and refreshes the cards. Historical NASA/GAEZ/Copernicus requests
load when their respective pages or results views open. Open-Meteo/CAMS source
links are displayed with the cards. The public Open-Meteo endpoints are intended
for this noncommercial local prototype; a commercial deployment should use the
provider's customer endpoints and credentials according to its terms.

References: https://open-meteo.com/en/docs and
https://open-meteo.com/en/docs/air-quality-api . The current model is not a soil
fertility measurement, and the home cards do not change crop suitability scores.

Verification: `python manage.py test website.test_home_conditions` covers source
units, missing/old data, complete-week rain counts, three coordinate-specific
requests, independent failures, pin isolation and the Crop layout. Browser QA
`node tools/preview-home.mjs` uses an isolated temporary database to test actual
pin saves and a live source response, then explicitly simulated card values for
repeatable UI checks. It checks the desktop/mobile layout, navigation, rotation,
alerts, source failures, account states beside language, Lao/Thai and clearing
old readings. No test accounts or pins are written to the farmer's database.

## Document-based workspace pages

The layout reference is the user-supplied `Mekong rise (2).docx`. Its drawings
guide the inner-page structure; embedded example values are not used as readings.
The existing `/map/` design, login page, header controls, map and pin-results
popup are preserved. Only the main sidebar destinations change to real routes:

| Sidebar | Route | Contents |
| --- | --- | --- |
| Crop | `/workspace/crops/` | Real crop photos, pin-specific rankings, source details and saved rotation |
| Market | `/workspace/market/` | All imported references, currency conversion, price graphs and a manual income scenario |
| NASA data | `/workspace/nasa/` | Six overview cards, three observed-pattern charts and expandable full history/satellite details |
| Alerts | `/workspace/alerts/` | Six condition selectors, dated saved-pin readings and the Alert Mekong map |
| Farm help / Orbee | `/workspace/orbee/` | Guided crop, weather, soil/water, rotation, market and plant-health topics |

The new pages reuse existing data controllers and APIs, with no duplicate farm
records or altered crop-scoring method. The NASA overview receives the same
dated history response used by its detailed chart. Rainfall is the total of
observed days, with coverage shown. Mini charts leave missing observations as
gaps. Solar radiation remains explicitly unavailable in the currently connected
history feed. NDVI uses the processing result when available; it is not inferred
from catalogue cloud cover or fabricated when credentials are absent.

Alert Mekong uses Esri World Imagery, as on the home map, and bundled Natural
Earth country borders with attribution. If a tile fails or takes more than
15 seconds, it removes the image layer and retains labelled country outlines
and the saved pin. A translated, explicit retry button can reload imagery;
there is no automatic retry loop or dependency on OSM's volunteer tile service.
Satellite images may be older than current field conditions. Its
marker represents the saved field only; unassessed regions are not coloured as
hazard zones. Dry-day counts, previous-week rain, modelled air temperature and
CAMS PM2.5 use the existing pin-specific conditions endpoint. Source times and
older estimates are shown. Flooding and crop stress remain explicitly unassessed
without a connected river/inundation feed and usable crop-stress observations.
These indicators are not disaster forecasts or official warnings.

Orbee combines a topic guide with optional server-side Claude chat and links to
real app records. It does not perform disease diagnosis. The market
income calculator uses the farmer's entered harvest, quote and optional costs;
its arithmetic is not a forecast of yield or profit. Actual market time trends
and demand data remain unavailable rather than generated from a single range.

Guest navigation grants one deliberate next-page entry, including links between
workspace pages and back to the map. Refreshing a guest page returns to login;
authenticated users keep their session. Light/dark preferences and language
controls carry between pages. Inner-page CSS is scoped to `.workspace-page`,
with responsive layouts, keyboard controls and reduced-motion support.

`python manage.py test website.test_workspace` verifies routes, sidebar links,
home/popup preservation, account controls and honest missing-data states.
`node tools/preview-workspace.mjs` checks actual navigation, pin-results popup,
guest refresh, member refresh, NASA overview charts, Alert Mekong, income
arithmetic and mobile/dark layouts with an isolated temporary database.
`node tools/preview-alert-map.mjs` checks live Esri tiles, simulated tile failure,
local boundary fallback, saved-pin preservation, explicit retry recovery and
Lao/dark/mobile layout. Weather responses in this map-specific browser check are
explicit fixtures; the production conditions endpoint is unchanged.

## Orbee mascot and Claude chat

Orbee uses the user's fluffy white, plumeria-flower character references in two
transparent poses: greeting and resting. The home map and workspace pages have
a collapsed **Ask Orbee** launcher. It opens a compact, nonmodal chat box; Escape,
the close button or clicking outside closes it. It yields to native results and
settings dialogs, preserving the existing home layout and pin-result popup.
The Orbee page pairs a larger mascot with the full conversation view, without
adding a second floating chat instance. The login page is unchanged.

When Claude is configured, typed questions and topic buttons call the real
Anthropic Messages API through Django. Orbee supports free-form conversation
and up to six previous successful turns, with the selected English/Lao/Thai
language passed to Claude. The visible thread is bounded to 21 messages. AI
output is displayed as plain text; it cannot execute actions or load HTML.
Replies are not generated by a keyword lookup when AI mode is enabled.

Without an API key, the connection status explicitly says that only topic-guide
buttons are available. Typed questions explain that AI is offline rather than
silently returning a canned feature description. A prominent connection badge
distinguishes App guide, configured Claude and a successful Claude reply. The
browser checks status again for every new message, so a restored connection is
picked up without relying on a previous page-load failure. Provider failures in AI mode produce an explicit error;
the app does not replace a failed Claude answer with a canned reply.

Orbee's conversational instructions answer the question first, explain reasons
and practical trade-offs, define technical terms, and ask at most one useful
follow-up when a decision needs more information. App links are optional next
steps after a substantive explanation. General concepts can be explained without
a selected pin. Matching published FAO crop profiles (requirements, water,
growing duration and source) are included for English/Lao/Thai crop names and
recent follow-up references. Matching public market references also work without
sharing private field data. Missing local data remains explicitly missing.

To enable Claude locally, stop the current Django server with Ctrl+C and run:

```powershell
.\.venv\Scripts\python.exe manage.py run_orbee 127.0.0.1:8000
```

For one-time setup, open `.env` beside `manage.py` and set
`ANTHROPIC_API_KEY=your_new_key` locally. The file is excluded from version
control and is never served to the browser. Django reads it automatically on
each startup, so the command skips the key prompt on later runs. Keep this file
private; use a replacement key if an earlier key was exposed. `.env.example`
is the shareable blank template. Do not add real keys to `settings.py`.

If no key is configured, the command still offers the hidden terminal prompt;
a key entered there is only used for that server session. The command verifies
access through the Models API and starts Django without an auto-reloader. It
does not write or change your private `.env` file. Restart Django after changing
`.env`. API usage uses the owner's Anthropic API account and credits. This is
for a direct Anthropic key; OpenRouter/Bedrock/cloud credentials need their own
provider adapter. Do not paste keys into chat, templates or browser JavaScript.

Stop an existing server on that port first. The launcher checks port availability
before requesting the key, so an old plain Django server cannot remain in place
while a failed second startup appears connected. Keep the new terminal running.
Because the private-key launcher disables auto-reload, restart it after backend
code changes. In development (`DEBUG=True`), template files are read from disk
on every render so layout edits do not require restarting a private-key session.
Production retains Django's cached template loader. Refresh with Ctrl+F5 after
static CSS/JavaScript changes. The weather header also upgrades the original
cached markup in an already-running older server.
The status endpoint includes `reply_style: conversational-v2`; a
new browser talking to an older server displays a restart notice.

Both `run_orbee` and `run_copernicus` inherit Django's **staticfiles** development
server, so CSS, JavaScript, SVG icons, fonts and mascot artwork are served in
development alongside the app. Using the basic core runserver class instead
would return HTML 404s for those files and trigger the browser's strict MIME
errors. This is handled by the launchers; no change to the home design or asset
URLs is needed. Production still requires its normal collected-static hosting.
`python manage.py test website.test_connected_servers` exercises both command
handlers against real asset files. `node tools/preview-connected-static.mjs`
starts the actual Orbee launcher with explicitly mocked external authentication
and an isolated database, checks all page assets return 200 with correct MIME
types, and verifies the NASA layout, theme/language controls and home map.

The default model is `claude-sonnet-5-5`. An accessible model can be selected with
`--model MODEL_ID` or the server variable `ORBEE_MODEL`. Deployments may supply
`ANTHROPIC_API_KEY` and, if required for their key, `ANTHROPIC_WORKSPACE_ID` via
their server environment and start Django normally. The project-root `.env`
is loaded with python-dotenv, without replacing existing environment variables
or expanding variable references inside secret values. Existing Copernicus
variables remain independent. `python manage.py test website.test_local_environment`
checks reload persistence, environment precedence, no parent-directory lookup,
server-only file access and configured-key startup without a prompt or paid API call.

The optional **Use my field data** checkbox includes the current farmer's saved
pin (coordinates rounded to four decimals), plan and bounded previously loaded
environmental/crop/satellite records. Records have dates and source metadata;
missing sources remain missing. Chat does not launch slow NASA/GAEZ/Sentinel
downloads. Relevant matching spreadsheet price references retain their original
currencies, year and source. No account email, phone, other farmer's field or
API credentials enter the prompt. Turning sharing off clears conversational
context before the next request. New pin selections also clear it, and answers
for a pin changed during generation are discarded. Source records are untrusted
data in the prompt, not instructions. Claude is instructed to distinguish
general advice from local evidence, and not to invent measurements or guarantees.
These instructions guide the model; they do not guarantee factual correctness.

`GET /api/orbee/chat/` reports configuration without exposing a key.
CSRF-protected `POST /api/orbee/chat/` validates text, roles, language and bounded
history before calling `https://api.anthropic.com/v1/messages`. The browser
explains that messages and selected field data go to Anthropic. This app does
not persist transcripts: they remain in page memory, and navigation/refresh
starts a new chat. Rate counters and bounded source snapshots are stored in
ignored `.orbee_cache/`, without API keys or conversations. Requests allow at
most 1,800 output tokens for English and 3,600 for Lao/Thai conversation text.
The larger allowance also applies when the user types Lao/Thai in an English
interface. Sonnet 5.5 uses its documented `between_tools` thinking mode at low
effort for this text-only chat, leaving the output budget for the visible reply;
the option is not sent to unrelated model versions. Upstream socket timeout is
55 seconds and the browser allows 65 seconds, with a 75-second in-flight guard.
Reference: https://platform.claude.com/docs/en/build-with-claude/thinking .

Timeouts, interrupted networks, unreadable/empty replies and a token budget
exhausted before visible text have separate sanitized error codes. Temporary
reply failures do not label the API connection as broken or require the farmer
to re-enter a key. **Retry message** reuses the original question and successful
history without duplicating its user bubble. No automatic paid retries occur.
The server logs only a status code and a validated provider request ID, with no
key, prompt, reply text or raw provider error body. The status endpoint's
`response_policy: multilingual-v1` lets a new browser detect an older server
that needs a restart. Local controls permit 30 requests per actor, 45 per IP and 150
globally per 15-minute bucket, and one concurrent request per actor. A public
multi-worker deployment should use a shared atomic rate-limit service and
provider-side spend limits; the file cache is a local-prototype control.

API contract/model references: https://platform.claude.com/docs/en/api/messages/create
and https://platform.claude.com/docs/en/models/overview . The real integration
cannot be verified with a live provider until the owner enters a valid key.

The sprite atlas, full generation prompt and provenance are in
`website/static/website/orbee/`. The built-in image tool generated the original
PNG; the web uses a same-size alpha-preserving WebP copy about 85% smaller.
CSS switches between the two poses for a short greeting. Motion respects the
operating system's reduced-motion setting. Native buttons, input labels, an
announced conversation log, close-focus restoration, dark mode and translated
guided replies support accessible use.

`python manage.py test website.test_orbee` checks shared-widget uniqueness,
home/popup preservation, the full-page chat, topics and the artwork format.
`node tools/preview-orbee.mjs` verifies transparent artwork, typed questions,
Lao routing/replies, safe text, guest link navigation, keyboard dismissal,
modal coexistence, mobile layout, dark mode and reduced motion in an isolated
temporary database. `--prepare-artwork` explicitly regenerates only the WebP
delivery copy from the original PNG using the browser encoder.

`python manage.py test website.test_orbee_ai` verifies the real HTTP request
contract using a mocked provider, follow-up context, field opt-out, account/pin
isolation, CSRF, request limits and sanitized failures. `node
tools/preview-orbee-ai.mjs` uses explicitly simulated Claude responses to check
free-form/follow-up UI, sharing, loading/error states, language and mobile chat.
It never makes paid Claude calls or claims live-provider verification.
It also verifies that a simulated timeout offers retry without requesting
reconnection, and that retry preserves the question/history and message count.

## Plant market references and currency conversion

Open **Market** from the home navigation. Search English or Lao plant names,
filter five crop groups, and choose **Learn more** to see the plant's price-range
graph, growing duration, and planting calendars for Laos, Thailand, Myanmar,
Vietnam and Cambodia. Expand the original cells for every detail from the sheet.
Prices are per kilogram. The graph compares low/high ranges; it is not a price
history or a profit forecast.

The supplied Google spreadsheet (tab `416596500`) contains 59 crop rows. Its
combined cassava/sweet-potato row is split into two products, giving 60 products.
The explicitly stated raw-cassava price and growing duration are kept separate
from sweet potato. No world-reference price is supplied for raw cassava.

The source describes average wholesale/retail reference ranges for **2026**.
Exact survey dates, named markets, product grades and independent verification
are unavailable. These are not live farm-gate offers. The interface displays the
source, reference year and import date; changing currency does not turn a Lao
quote into a Thai-market quote. Original Lao calendar notes are preserved.

The imported snapshot is `website/data/market_source.csv`, accompanied by source
metadata and a SHA-256 checksum in `market_source.json`. `GET /api/market/` serves
the validated snapshot without downloading Sheets on every page load. To import
an updated public sheet explicitly, run from the project directory:

```powershell
.\.venv\Scripts\python.exe tools\sync_market_sheet.py
```

The importer reads the sheet and validates it before saving; it does not edit
the Google spreadsheet. **Reload market data** reloads the imported catalogue
and reference currency response, rather than re-importing Google Sheets.

`GET /api/market/rates/` retrieves dated USD/LAK/THB reference rates from
`https://api.frankfurter.dev/v2/rates?base=USD&quotes=LAK,THB&expand=providers`.
Conversions use `price * target_rate / source_rate`, retaining both original
quote currencies and the exchange-rate dates. These are display conversions,
not bank, cash or transfer offers. Successful responses are cached for six
hours in ignored `.market_cache/`. On failure, a last-good dated result or the
bundled, actually retrieved `market_fx_snapshot.json` may be used only while its
rates are at most seven days old, and is labelled as saved. Failure responses
are cached for two minutes. Without valid rates, prices remain in their original
currencies and the graph compares only ranges in the same currency.

Matching suitability cards link to exact source products, including field maize
and separate tomato varieties. The sheet has no matching price for several
evaluated crops, including rice, coffee and banana fruit; these are explicitly
marked unavailable. Market prices do not change FAO requirements, suitability
scores or agronomic rankings. Spreadsheet planting notes remain separate from
verified local advice.

`python manage.py test website.test_market` covers all source rows/cells,
product separation, exact crop matching even if rows are renumbered, missing
prices, malformed ranges, invalid/old currency rates, outage behaviour and
read-only API routes. `node tools/preview-market.mjs` checks all products,
currency arithmetic, the graph, crop-card links, original notes, source failures,
and desktop/mobile/light/dark layouts using an isolated temporary database.

## Miniature region view and street-level photos

Above the farm map, Country view fits the country containing the selected pin
(or the map centre when no pin exists). Mini map toggles a small vector overview
with the five supported countries, a highlighted pin country, field dot and a
gold rectangle representing the current main-map viewport. Clicking the mini
map moves the main view without selecting/saving another farm. Whole region
fits all supported countries. The existing Show region control still works.
The overview uses bundled Natural Earth borders; it does not request another
set of imagery tiles or claim province-level boundaries. On narrow maps the
miniature view starts collapsed and opens above the map, avoiding the controls.

The person / Street View button opens a compact dialog for the selected field
point. Choose another point temporarily lets a map tap select a viewing point
without moving or saving the farm pin. Escape cancels this mode. Open Google
Street View launches the documented `api=1&map_action=pano&viewpoint=lat,lon`
URL in a separate tab. Google chooses the nearest available panorama; there is
no guarantee that the photo is at the exact field or available in rural areas.
This is a handoff to 360-degree photographs, not an embedded 3D terrain/building
renderer or an authenticated Google Maps API integration. No key is needed for
this URL handoff; see https://developers.google.com/maps/documentation/urls/get-started .

`node tools/preview-map-explorer.mjs` tests the country zoom, miniature viewport,
mobile expansion, translated controls and Street View URL construction. It
confirms that choosing a street-view point does not select/save the farm pin.
All saved QA locations are in an isolated temporary database.

### Weather feed failures

If the home weather request fails while the independent CAMS air feed works,
the app retains the valid PM2.5 reading and tries the existing NASA POWER weekly
endpoint asynchronously. A successful fallback is explicitly labelled Recent
7-day average (or Older weekly summary), with NASA source and exact UTC dates.
NASA's 2 m wind is converted from m/s to km/h and labelled Wind (2 m); it is
never presented as the current-model wind at 10 m. Dry-day counts use only seven
valid consecutive NASA daily readings and are labelled latest available week,
with the dated NASA period in alert details. This can be older than the primary
model's previous seven days. A fallback is not a present weather observation.

Retry current weather calls the home endpoint with `refresh=1`. It can bypass
a cached partial failure once per 30 seconds; healthy cached data are reused.
Pin changes cancel and clear both current and fallback requests. A fallback
failure preserves any independent successful readings and keeps missing values
blank. The home retry/fallback never configures Copernicus: NDVI processing still
requires server-side Sentinel Hub credentials as described in the connection
section above. A public catalogue pass date is not an NDVI measurement.

Browser QA for map tools includes an explicitly simulated primary-weather
failure with a real dated NASA read at the screenshot's Myanmar coordinates,
then a simulated recovered current-model response to check retry and source/height
labels. Backend tests cover cached-failure recovery and retry cooldown.

## Compact map and field-results popup

The main page is a compact satellite-map workspace. A large yellow crop-icon button appears beside the field pin; the pin or its yellow View results control opens the results. The duplicate fixed bottom-right results button has been removed. The controls have bold text and touch targets of at least 64 pixels. Lao and Thai labels are supported. Clicking the existing pin also opens its results.

Choose a location, then press View results. If it is a new/unsaved pin, the button saves it before opening the dialog. This action is explained beside the map. Failed saves preserve the unsaved pin, offer the same action for retry, and do not open results or reuse a previous location's readings. Duplicate presses while saving are ignored.

The dialog has four large tabs: Crops, Weather & soil, Vegetation, and My plan. Up to three dynamically ranked crop candidates appear first, with the complete sourced comparison available in All crops compared. Each rating has an expandable explanation; soil/climate context, yield context, comparison methodology and the full advanced catalogue remain available in collapsed sections. The Crop tab also contains the saved crop rotation, reached with View crop rotation. The other tabs contain the existing NASA readings, optional local checks, Copernicus monitoring, timeline and calendar. Source data and missing-data handling remain unchanged.

Native modal semantics, visible focus, Tab/Shift+Tab containment, arrow-key tab navigation, Escape and a large Back to map button support keyboard use. Closing restores focus to the map action. Scrolling is contained in the dialog instead of producing a long main page. The old #gaez-explorer, #insights, #crop-plan and #calendar links open their corresponding results tab; calendar month links continue to work.

`node tools/preview-results.mjs` verifies the real UI on desktop and 390-pixel mobile screens, data loading after opening, real crop-result reads, translated pin actions and tabs, focus containment, direct hash links, old-reading cleanup, and save failure/retry/double-click protection. Browser save requests are intercepted and use the already persisted location, so this check does not change the user's database.


## Local Lao typography

Noto Sans Lao is self-hosted at `website/static/website/fonts/NotoSansLao-Variable.ttf` and applied to the app, Leaflet controls and inherited form fonts. It supports variable weights and uses `font-display: swap`; no Google Fonts request is needed at runtime. The original SIL Open Font License accompanies it as `NotoSansLao-OFL.txt`. Source: https://github.com/google/fonts/tree/main/ofl/notosanslao . Browser QA verifies that the family is selected and loaded for Lao glyphs.
# Map coverage

Field pins are restricted to **Laos, Thailand, Myanmar, Cambodia and Vietnam**.
The same bundled country polygons validate map clicks, marker dragging, device
location, manual coordinates and Django location-save requests. Outside pins are
rejected without changing the saved field. Existing pins outside this coverage
remain in the database, but users must choose a supported pin before opening map
results. The **Show region** button displays the complete supported area. Map
panning and minimum zoom stay near this region; surrounding countries remain
visible as shaded context.

This is five-country coverage, not a Mekong watershed boundary. Borders are
generalized Natural Earth Admin 0 country polygons at 1:50m scale, so they are
approximate near coastlines and international borders. The GeoJSON includes its
source, retrieval date, license and source checksum, and is served locally with
the page. To deliberately update the bundled data:

```powershell
.venv\Scripts\python.exe tools\build_mekong_region.py --retrieved-on YYYY-MM-DD
```

Region checks: `python manage.py test website.test_region website.tests`.
Browser checks: `node tools/preview-region.mjs` (local server required; no valid
field locations are saved to the user's database).


## Weather history, wind and soil

Select a supported field pin, press **View results**, then choose **Weather & soil**
(or open `http://127.0.0.1:8000/map/#insights`). The history notebook has four periods:
100 recent days and 365 recent days, ending two days before the local date; or
five/ten complete past calendar years. For example, during 2026 the ten-year
view covers 2016?2025. Records use UTC dates. The exact requested dates, source
retrieval time, parameter names, valid/missing counts and latest date of each
measurement are available under **Sources, dates and missing data**.

`GET /api/weather/history/?period=100d|1y|5y|10y` reads only the saved pin. It uses
NASA POWER daily `PRECTOTCORR`, `T2M`, `T2M_MAX`, `T2M_MIN`, `WS2M`, `RH2M`,
`SFMC`, `RZMC`, `GWETTOP` and `GWETROOT`. No demo data or ML output is used.
The 100-day view and existing weekly card share one locked/cached source read
(six hours). Longer periods are requested only when selected and cached for
24 hours. Failures are cached for two minutes. Responses are discarded if the
saved pin changes during source reads. Frontend requests are also cancelled and
old data cleared when the farmer selects another pin.

Rainfall is plotted daily for short periods and as monthly totals for five/ten
years; the other measurements use daily values or monthly means. Daily highs
and lows in a monthly chart are means of the daily highs/lows, not monthly
absolute extrema. Temperature extrema in the pattern cards come from the
actual daily max/min series. Wind is the mean speed at 2 m in m/s, not gust speed.
Rainy days use >=1 mm; observed dry spells use <1 mm, with missing days breaking
runs. These are descriptive thresholds, not crop-specific irrigation advice.
Monthly/yearly rainfall totals require every requested day; partial observed
rainfall is separately labelled. Seasonal averages use only complete months with
complete rainfall. First/last year comparisons (or equal halves for shorter
windows) require complete readings for the variable being compared. They are
not trend attribution or predictions. No forecast probability is generated.

Soil volumes (`SFMC`/`RZMC`, m3/m3) and wetness indices (`GWETTOP`/`GWETROOT`, 0?1)
are never mixed on one axis or relabelled. If the source provides any valid
volumetric soil values for the requested period, that quantity is selected and
missing dates stay gaps; otherwise the wetness index is used. The Lao test pins
currently return the wetness index. Neither quantity measures fertility. These
are regional model estimates and nearby farms can share values.

The date slider and chart buttons support touch/keyboard use; daily tables are
rendered 50 rows at a time and CSV export contains the entire requested series,
with missing readings left blank and soil parameter/units in the header. History
loads only when the weather tab opens. Source documentation:
https://power.larc.nasa.gov/docs/services/api/temporal/daily/ and
https://power.larc.nasa.gov/docs/methodology/data/sources_hydrology/ .

The weather header follows the selected saved pin. `/api/place/` reverse-geocodes
its local town/village/district using OpenStreetMap Nominatim, then searches
geotagged Wikimedia Commons photographs within 10 km and in the same supported
country. The card shows the mapped area name and coordinates; a verified nearby
photo is optional. Each displayed image includes its geotag distance, photographer,
source file and license. It is explicitly a nearby reference photograph, not a
live view or an exact view of the field. No landmark or photograph is invented.
When no suitable photo is found, the same card uses the local area name. If the
geocoder is unavailable, the known country and pin coordinates remain visible
with an unavailable notice. The previous fixed Vang Vieng example image is no
longer rendered in the weather header; its original asset/credit metadata remain
in the repository for provenance.

The lookup starts only when Weather & soil opens and runs independently of NASA
weather requests. Pin changes immediately remove the old label/photo, abort the
pending request, and discard late replies. The server reads only the current
farmer's saved pin and rejects results if it changes during a lookup. Successful
place reads are cached for 30 days in ignored `.place_cache/`; source failures are
cached for two minutes. Remote JSON reads and browser image waits are bounded.
Only credited, freely licensed JPEG/WebP geotagged images from official Wikimedia
hosts are accepted; country borders are the same approximate polygons as the map.
Attribution links are displayed in the card. Location names retain their source
spelling while interface labels support English, Lao and Thai.

Nominatim requests have an identifying User-Agent, caching and a one-request-per-
1.1-second limiter in the local server. `PLACE_GEOCODER_URL` can switch the reverse
geocoder through server configuration. A multi-worker deployment must share an
application-wide rate limiter or use its own geocoding service; the local process
lock does not coordinate multiple workers. Provider references:
https://nominatim.org/release-docs/latest/api/Reverse/ ,
https://operations.osmfoundation.org/policies/nominatim/ ,
https://www.mediawiki.org/wiki/API:Geosearch and
https://www.mediawiki.org/wiki/API:Imageinfo .

Popups have a short entrance with a slight overshoot; clicked buttons have a
small bounce, and results tabs fade in. `motion.css` and `motion.js` apply these
without changing navigation or introducing loading delays. Reduced-motion
preferences disable the effects, including when changed while the page is open.

`python manage.py test website.test_place_context` checks locality parsing,
country/distance/license constraints, source outages, caching, pin isolation and
late-response rejection. `node tools/preview-place-context.mjs` uses an isolated
temporary database to exercise real pin saves and live place/photo reads in
Vietnam (including the screenshot's 13.15081, 108.43705 pin), Hanoi and Vientiane.
It also checks mobile layout, Lao, animation preferences and an explicitly
simulated late-response race. It never modifies the user's farm database.

Verification: `python manage.py test`; `python tools/validate_weather_history.py`
(live source reads at Vientiane, Paksong and Phongsaly; no field writes); and
`node tools/preview-weather-history.mjs` (live 100-day/1-year/5-year/10-year UI,
wind/soil/temperature charts, CSV, paging, Lao/Thai, mobile and explicitly
simulated network-failure/race tests). Live-source results are recorded in
`reports/weather-history-validation.md` and `.json`.

## Real crop photographs

All 13 bundled crop profiles now use locally stored reference JPEG photographs
from Wikimedia Commons. The Crops tab uses larger photo headers, white cards,
plain ranks and a compact score row. Climate values are grouped in a neutral
summary strip. Existing crop requirements, location data, scores and ranking
rules are unchanged. Photos are explicitly reference examples, not observations
of the selected farm or promises about a local cultivar.

Photographer and license links are shown directly below every photograph. The
expanded crop details link the full file title and explain display cropping.
`website/data/crop_photos.json` preserves source URLs, author, license, retrieval
date, original description, local checksum and framing. Portable image credits
are also bundled in `website/static/website/crops/PHOTO-CREDITS.md`. Individual
photographs retain their listed CC BY, CC BY-SA, CC0 or public-domain terms.
The complete set is approximately 1.3 MB; images load lazily and require no
external photo requests when farmers open the app. A failed image shows a text
notice instead of an invented picture.

Migration `0007_crop_photographs` updates only default illustration paths, leaving
other profile fields intact and preserving customized image paths. The bundled
profile import and reference-sync helper also use the JPEG paths. Photo credits
are attached only when the profile uses that exact curated image path.
`node tools/preview-crop-photos.mjs` checks all 13 real image loads, attribution
links, desktop/mobile presentation, Lao captions and the failed-image state
without changing the farmer's saved location.

## MekongRise login and optional farmer accounts

Open **http://127.0.0.1:8000/** to start. New visitors see the login page;
returning signed-in users go straight to the map at `/map/`. You can also open
**http://127.0.0.1:8000/login/** directly, or
**http://127.0.0.1:8000/signup/** to create an account. The dashboard header has a
Sign in link for guests and a round profile button for signed-in farmers. The
profile panel shows the account's email/phone and a Sign out button. The name is
now **MekongRise**, with **Save Water. Breathe Clean.
Earn More.** below the brand. The login page follows the supplied sketch: name and slogan above three stacked
benefit labels on the left and the sign-in form on the right. A real terraced-farm
photograph fills the background; the earlier inset photo and promotional
sentences have been removed. English, Lao and Thai use the self-hosted font. The three
benefit labels express the project's goals; this change does not add a PM2.5
measurement or an emissions calculation.

Login is optional: **Continue as guest** opens the existing public workspace for
that visit. Refreshing or revisiting the map as a guest returns to login, even
without signing out. Intentional calendar navigation and field/calendar form
submissions stay within the current visit. Signed-in accounts keep their normal
persistent session and can refresh directly into the map.

`guest-access.js` implements this browser-navigation behavior. The login's guest
links grant a one-use, short-lived sessionStorage entry that is consumed before
the map renders. With storage blocked, an explicit guest-entry query is consumed
and immediately removed from the address bar. Reloads/direct revisits have no
entry; restored guest pages also return to login. This is navigation UX, not
account authentication or an access-control boundary: the shared public guest
workspace and its API endpoints remain public. Only signed-in accounts get a
private field/calendar. Login benefit text now sits in a flat dark forest-green
introduction block with dividers, without interactive control styling.

Its existing field, saved coordinates, crop plan and calendar remain in place.
New signed-in accounts get a separate field and calendar; they do not inherit or
claim the public workspace. Every field-data endpoint reads the current user's
field, and event completion is restricted to that user's calendar. New private
fields have no coordinates or known area until supplied. An unknown area is
shown as **Area not set** rather than copying the starter example's hectares.
Existing rows retain their existing area values. This is still one saved field
per account, not a multiple-field management system.

Register with an email address (including Gmail), phone number, or both, plus a
MekongRise password. Either registered contact can be used to sign in. Lao phone
numbers accept national `020...` or international `+85620...` formats; other
countries use their international country code. Numbers are validated with
libphonenumber metadata and stored in canonical international format. This is
password sign-in, without Google OAuth or SMS ownership verification.

The forms use Django password hashing, CSRF protection, authenticated sessions,
local-only next redirects and POST-only logout. Email lookup is case insensitive;
ambiguous duplicate email records are rejected. Existing administrator username
login continues to work at `/admin/`. Sign-in uses a persistent cookie valid for
30 days after the last visit, including after the browser closes. Clearing
cookies or signing out requires a fresh sign-in; logout invalidates the server
session. Authenticated pages and entry redirects are not cached. Repeated failed attempts
are limited to 15 per direct client IP for five minutes using Django's cache.
For a deployment with several worker processes, use a shared cache and configure
HTTPS, allowed hosts, secret key and the normal production settings. Email
verification and password-reset delivery are not configured or advertised.

Migrations `0008_farmer_accounts`, `0009_unknown_field_area` and
`0010_farmer_phone` add nullable ownership links, permit an unknown field area,
and store optional unique phone contacts. They preserve the existing
public workspace; they do not assign its records to the first person who signs
up. Run `python manage.py migrate` after pulling these changes.

Verification: `python manage.py test website.test_authentication` covers email
and phone login, national/international phone normalization, missing/duplicate
contacts, profile privacy, first/returning-visit routing, password validation,
persistent sessions, CSRF, logout,
redirect checks, throttling and isolation between two farmers and the public
workspace. `node tools/preview-auth.mjs` starts an isolated temporary database and
server, then exercises real signup/email/phone login/logout, persistent cookies,
profile display, first/returning visits, guest map access, password
visibility, mobile layout and three languages in Chrome. It never creates test
accounts in the user's farm database. Internal translation and cache identifiers
retain their earlier names for compatibility with saved browser preferences.

The login background `website/static/website/login-farm.jpg` is **Terraces in Che
Cu Nha commune, Mu Cang Chai (Unsplash)** by **Doan Tuan (danny_pham93)**,
released under **CC0**. It is a genuine farm landscape from Vietnam, displayed
with CSS cover framing. The original file, download URL, license and local
checksum are retained in `website/static/website/login-farm-photo.json`; a source
link is visible in the login footer. Source:
https://commons.wikimedia.org/wiki/File:Terraces_in_Che_Cu_Nha_commune,_Mu_Cang_Chai_(Unsplash).jpg
