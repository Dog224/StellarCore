"""Bounded Copernicus Sentinel-2 catalogue, land NDVI statistics and imagery.

Only the saved pin is sampled. OAuth secrets and tokens never leave the server;
tokens live in process memory, while non-secret observations can be cached on disk.
"""
import hashlib
import json
import math
import threading
import time
from datetime import date, datetime, timedelta, timezone as utc
from urllib.error import HTTPError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.cache.backends.filebased import FileBasedCache
from django.utils import timezone

STAC = 'https://stac.dataspace.copernicus.eu/v1/search'
TOKEN = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
STATISTICS = 'https://sh.dataspace.copernicus.eu/statistics/v1'
PROCESS = 'https://sh.dataspace.copernicus.eu/process/v1'
SOURCE = 'https://dataspace.copernicus.eu/'
cache = FileBasedCache(str(settings.BASE_DIR / '.copernicus_cache'), {'TIMEOUT': 21600, 'OPTIONS': {'MAX_ENTRIES': 500}})
_tokens = {}
_token_lock = threading.Lock()

# Reject clouds, shadows, water, snow, unclassified and defective pixels. The
# resulting percentage is usable LAND coverage, not an exact cloud percentage.
MASK = 's.dataMask === 1 && (s.SCL === 4 || s.SCL === 5) && (s.B08 + s.B04) > 0'
STAT_SCRIPT = '''//VERSION=3
function setup() { return {
 input: [{bands: ["B04", "B08", "SCL", "dataMask"]}],
 output: [{id: "ndvi", bands: 1, sampleType: "FLOAT32"}, {id: "dataMask", bands: 1}]
}; }
function evaluatePixel(s) {
 const valid = VALID;
 return {ndvi: [valid ? (s.B08-s.B04)/(s.B08+s.B04) : 0], dataMask: [valid ? 1 : 0]};
}'''.replace('VALID', MASK)
IMAGE_SCRIPT = '''//VERSION=3
function setup() { return {input: ["B04", "B08", "SCL", "dataMask"], output: {bands: 4}}; }
function evaluatePixel(s) {
 if (!(VALID)) return [0,0,0,0];
 const n = (s.B08-s.B04)/(s.B08+s.B04);
 const stops = [[-1,[.83,.78,.62]], [0,[.94,.89,.70]], [.3,[.76,.82,.39]], [.6,[.25,.57,.29]], [1,[.04,.27,.17]]];
 for (let i=1; i<stops.length; i++) {
  if (n<=stops[i][0]) {
   const a=stops[i-1], b=stops[i], t=Math.max(0,Math.min(1,(n-a[0])/(b[0]-a[0])));
   return [a[1][0]+t*(b[1][0]-a[1][0]), a[1][1]+t*(b[1][1]-a[1][1]), a[1][2]+t*(b[1][2]-a[1][2]), 1];
  }
 }
 return [.04,.27,.17,1];
}'''.replace('VALID', MASK)


class CopernicusError(Exception):
    def __init__(self, status):
        self.status = status
        super().__init__(status)


def credentials():
    return (getattr(settings, 'COPERNICUS_CLIENT_ID', ''), getattr(settings, 'COPERNICUS_CLIENT_SECRET', ''))


def footprint(field):
    if not field or field.latitude is None or field.longitude is None:
        raise CopernicusError('needs_location')
    lat, lon = float(field.latitude), float(field.longitude)
    if not math.isfinite(lat + lon) or not -56 <= lat <= 84 or not -179.99 <= lon <= 179.99:
        raise CopernicusError('outside_coverage')
    dy, dx = 100 / 111320, 100 / (111320 * math.cos(math.radians(lat)))
    bbox = [lon-dx, lat-dy, lon+dx, lat+dy]
    pin = hashlib.sha256(f'{lat:.7f},{lon:.7f}'.encode()).hexdigest()[:20]
    return {'pin': pin, 'latitude': lat, 'longitude': lon, 'bbox': bbox,
            'bounds': [[bbox[1], bbox[0]], [bbox[3], bbox[2]]], 'sample_width_m': 200,
            'source': 'Copernicus Sentinel-2 L2A', 'source_url': SOURCE,
            'scope': 'A 200 m × 200 m area around your saved pin. This is not your field boundary.'}


def _request(url, payload=None, token=None, form=False, binary=False):
    headers = {'User-Agent': 'TerraGrow/1.0', 'Accept': 'image/png' if binary else 'application/json'}
    body = None
    if payload is not None:
        body = urlencode(payload).encode() if form else json.dumps(payload).encode()
        headers['Content-Type'] = 'application/x-www-form-urlencoded' if form else 'application/json'
    if token: headers['Authorization'] = 'Bearer ' + token
    try:
        with urlopen(Request(url, data=body, headers=headers), timeout=20 if token else 10) as response:
            limit = 2 * 1024 * 1024
            raw = response.read(limit + 1)
            if len(raw) > limit: raise CopernicusError('unavailable')
            if binary:
                if not raw.startswith(b'\x89PNG\r\n\x1a\n'): raise CopernicusError('unavailable')
                return raw
            data = json.loads(raw)
            if not isinstance(data, dict): raise CopernicusError('unavailable')
            return data
    except HTTPError as error:
        # Never relay provider bodies, request headers or credential-bearing data.
        status = 'access_required' if error.code in (400, 401, 403) and (token or form) else 'rate_limited' if error.code == 429 else 'unavailable'
        raise CopernicusError(status) from None
    except (OSError, ValueError, TypeError):
        raise CopernicusError('unavailable') from None


def access_token():
    client_id, secret = credentials()
    if not client_id or not secret: raise CopernicusError('not_configured')
    key = hashlib.sha256(f'{client_id}:{secret}'.encode()).hexdigest()
    with _token_lock:
        cached = _tokens.get(key)
        if cached and cached[1] > time.monotonic(): return cached[0]
        data = _request(TOKEN, {'grant_type': 'client_credentials', 'client_id': client_id, 'client_secret': secret}, form=True)
        token = data.get('access_token')
        if not isinstance(token, str) or not token: raise CopernicusError('access_required')
        try: lifetime = min(3600, max(0, float(data['expires_in']) - 30))
        except (KeyError, TypeError, ValueError): raise CopernicusError('access_required') from None
        _tokens.clear()
        _tokens[key] = (token, time.monotonic() + lifetime)
        return token


def catalogue_at_pin(field):
    try: base = footprint(field)
    except CopernicusError as error: return {'status': error.status, 'source_url': SOURCE}
    today = timezone.now().date()
    params = {'collections': 'sentinel-2-l2a', 'bbox': ','.join(f'{v:.7f}' for v in base['bbox']),
              'datetime': f'{today-timedelta(days=60)}T00:00:00Z/{today+timedelta(days=1)}T00:00:00Z',
              'limit': 30, 'sortby': '-datetime', 'fields': 'id,properties.datetime,properties.eo:cloud_cover,properties.platform'}
    url = STAC + '?' + urlencode(params)
    key = f'cdse-catalog-v1-{base["pin"]}-{today}'
    cached = cache.get(key)
    if cached is not None: return {**base, **cached}
    try:
        payload = _request(url)
        observations = []
        for feature in payload.get('features', [])[:30]:
            props = feature.get('properties', {})
            stamp = props.get('datetime', '')
            try: observed = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
            except (ValueError, TypeError, AttributeError): continue
            if observed.date() > today: continue
            cloud = props.get('eo:cloud_cover')
            cloud = round(cloud, 1) if isinstance(cloud, (int, float)) and not isinstance(cloud, bool) and math.isfinite(cloud) and 0 <= cloud <= 100 else None
            identifier = feature.get('id', '')
            observations.append({'id': identifier, 'observed_at': observed.isoformat(),
                                 'date': observed.date().isoformat(), 'tile_cloud_percent': cloud,
                                 'source_url': 'https://stac.dataspace.copernicus.eu/v1/collections/sentinel-2-l2a/items/' + quote(identifier, safe='')})
        observations.sort(key=lambda item: item['observed_at'], reverse=True)
        result = {'status': 'ok' if observations else 'no_observations', 'observations': observations,
                  'catalogue_url': url, 'retrieved_at': timezone.now().isoformat(),
                  'cloud_note': 'Catalogue cloud cover describes a large satellite tile, not the cloud cover over your field.'}
    except (CopernicusError, KeyError, TypeError, AttributeError) as error:
        result = {'status': error.status if isinstance(error, CopernicusError) else 'unavailable', 'observations': []}
    cache.set(key, result, 21600 if result['status'] in ('ok', 'no_observations') else 120)
    return {**base, **result}


def summarize_statistics(payload, today):
    observations = []
    for entry in payload.get('data', []):
        if entry.get('error'): continue
        try:
            day = date.fromisoformat(entry['interval']['from'][:10])
            stats = entry['outputs']['ndvi']['bands']['B0']['stats']
            count, missing, value = stats['sampleCount'], stats['noDataCount'], stats['mean']
            if any(isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) for v in (count, missing, value)): continue
            if day > today or count <= 0 or missing < 0 or missing >= count or not -1 <= value <= 1: continue
            coverage = (count - missing) / count
            if coverage < .8: continue
            observations.append({'date': day.isoformat(), 'ndvi': round(value, 4), 'usable_percent': round(100 * coverage, 1)})
        except (KeyError, TypeError, ValueError): continue
    observations.sort(key=lambda item: item['date'])
    # One point per UTC day; duplicated intervals are not an independent trend.
    observations = list({item['date']: item for item in observations}.values())
    result = {'status': 'ok' if observations else 'no_clear_observation', 'observations': observations,
              'trend': 'insufficient', 'delta': None, 'latest': observations[-1] if observations else None}
    if not observations: return result
    age = (today - date.fromisoformat(observations[-1]['date'])).days
    result['age_days'] = age
    if age > 21:
        result.update(status='stale', trend='stale')
    elif len(observations) >= 2:
        previous, latest = observations[-2:]
        if (date.fromisoformat(latest['date']) - date.fromisoformat(previous['date'])).days <= 21:
            delta = round(latest['ndvi'] - previous['ndvi'], 4)
            result.update(delta=delta, trend='decreased' if delta <= -.05 else 'increased' if delta >= .05 else 'little_change')
    return result


def vegetation_at_pin(field):
    try: base = footprint(field)
    except CopernicusError as error: return {'status': error.status, 'source_url': SOURCE}
    today = timezone.now().date()
    client_id, secret = credentials()
    # A new connection must not reuse a previous not-configured/failed response.
    identity = hashlib.sha256(f'{client_id}:{secret}'.encode()).hexdigest()[:16]
    key = f'cdse-ndvi-v1-{base["pin"]}-{today}-{identity}'
    if not client_id or not secret: return {**base, 'status': 'not_configured', 'observations': []}
    cached = cache.get(key)
    if cached is not None: return {**base, **cached}
    bbox = base['bbox']
    payload = {'input': {'bounds': {'bbox': bbox, 'properties': {'crs': 'http://www.opengis.net/def/crs/EPSG/0/4326'}},
                         'data': [{'type': 'sentinel-2-l2a', 'dataFilter': {'mosaickingOrder': 'mostRecent'}}]},
               'aggregation': {'timeRange': {'from': f'{today-timedelta(days=60)}T00:00:00Z', 'to': f'{today+timedelta(days=1)}T00:00:00Z'},
                               'aggregationInterval': {'of': 'P1D'}, 'evalscript': STAT_SCRIPT,
                               'resx': (bbox[2]-bbox[0])/20, 'resy': (bbox[3]-bbox[1])/20}}
    try:
        raw = _request(STATISTICS, payload, access_token())
        if not isinstance(raw.get('data'), list): raise CopernicusError('unavailable')
        result = summarize_statistics(raw, today)
        result.update(retrieved_at=timezone.now().isoformat(), minimum_usable_percent=80,
                      trend_threshold=.05, source_url='https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Statistical.html')
        if result['latest']:
            result['image_url'] = '/api/copernicus/image/?' + urlencode({'pin': base['pin'], 'date': result['latest']['date']})
    except CopernicusError as error:
        result = {'status': error.status, 'observations': []}
    cache.set(key, result, 21600 if result['status'] in ('ok', 'stale', 'no_clear_observation') else 120)
    return {**base, **result}


def vegetation_image(field, pin, observed):
    base = footprint(field)
    if pin != base['pin']: raise CopernicusError('pin_changed')
    data = vegetation_at_pin(field)
    if data['status'] not in ('ok', 'stale'): raise CopernicusError(data['status'])
    if not any(item['date'] == observed for item in data.get('observations', [])):
        raise CopernicusError('invalid_observation')
    key = f'cdse-image-v1-{pin}-{observed}'
    cached = cache.get(key)
    if cached is not None: return cached
    day = date.fromisoformat(observed)
    payload = {'input': {'bounds': {'bbox': base['bbox'], 'properties': {'crs': 'http://www.opengis.net/def/crs/EPSG/0/4326'}},
                         'data': [{'type': 'sentinel-2-l2a', 'dataFilter': {'timeRange': {'from': f'{day}T00:00:00Z', 'to': f'{day+timedelta(days=1)}T00:00:00Z'}, 'mosaickingOrder': 'mostRecent'}}]},
               'output': {'width': 20, 'height': 20, 'responses': [{'identifier': 'default', 'format': {'type': 'image/png'}}]},
               'evalscript': IMAGE_SCRIPT}
    image = _request(PROCESS, payload, access_token(), binary=True)
    cache.set(key, image, 21600)
    return image
