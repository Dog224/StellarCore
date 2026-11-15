"""Optional pin-specific place labels and credited nearby Wikimedia photographs.

This is visual context, independent of every weather/agronomy calculation.
No stock photograph is substituted for a location without a nearby image.
"""
import html
import json
import math
import re
import threading
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.cache.backends.filebased import FileBasedCache
from django.utils import timezone
from django.utils.html import strip_tags

from .region import contains_location, map_region

cache = FileBasedCache(str(settings.BASE_DIR / '.place_cache'), {'TIMEOUT': 2592000, 'OPTIONS': {'MAX_ENTRIES': 2000}})
_geocoder_lock = threading.Lock()
COMMONS = 'https://commons.wikimedia.org/w/api.php'
USER_AGENT = 'MekongRise/1.0 (farm-map place context; interactive Django application)'


def _json(url, params):
    request = Request(url + '?' + urlencode(params), headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
    with urlopen(request, timeout=4) as response:
        body = response.read(1000001)
    if len(body) > 1000000:
        raise ValueError('Source response too large')
    return json.loads(body)


def _text(value, limit=250):
    return html.unescape(strip_tags(str(value or ''))).strip()[:limit]


def _url(value, hosts):
    parts = urlsplit(str(value or ''))
    return value if parts.scheme == 'https' and parts.hostname in hosts and not parts.username else None


def country_at(latitude, longitude):
    for feature in map_region()['features']:
        if contains_location(latitude, longitude, {'features': [feature]}):
            return feature['properties']
    return None


def _address(latitude, longitude, country):
    # The public Nominatim instance permits at most one request/second/app.
    # This local application uses a process lock plus a disk-persisted timestamp.
    # Do not queue rapid pin changes; coordinates remain usable as the fallback.
    with _geocoder_lock:
        last = cache.get('geocoder-last-request', 0)
        if time.time() - last < 1.1:
            return None
        cache.set('geocoder-last-request', time.time(), 60)
        base = getattr(settings, 'PLACE_GEOCODER_URL', 'https://nominatim.openstreetmap.org/reverse')
        data = _json(base, {'format': 'jsonv2', 'lat': latitude, 'lon': longitude,
                            'zoom': 14, 'addressdetails': 1, 'accept-language': 'en'})
    address = data.get('address', {})
    expected = {'LAO': 'la', 'VNM': 'vn', 'THA': 'th', 'MMR': 'mm', 'KHM': 'kh'}[country['code']]
    if address.get('country_code') != expected:
        return None
    locality = next((_text(address.get(key)) for key in ('village', 'town', 'city', 'hamlet', 'municipality', 'county', 'state_district', 'state') if address.get(key)), '')
    region = _text(address.get('state') or address.get('region'))
    if not locality:
        return None
    label = ', '.join(dict.fromkeys(part for part in (locality, region, country['name']) if part))
    return {'name': locality, 'label': label, 'country': country['name'], 'source': 'OpenStreetMap contributors',
            'source_url': 'https://www.openstreetmap.org/copyright', 'scope': 'Nearest mapped locality; boundaries may be approximate.'}


def _distance(latitude, longitude, other_lat, other_lon):
    lat, other = math.radians(latitude), math.radians(other_lat)
    a = math.sin((other - lat) / 2) ** 2 + math.cos(lat) * math.cos(other) * math.sin(math.radians(other_lon - longitude) / 2) ** 2
    return 6371 * 2 * math.asin(min(1, math.sqrt(a)))


def _nearby_photo(latitude, longitude, country):
    # Search geotagged media itself, rather than an article's generic lead image.
    data = _json(COMMONS, {'action': 'query', 'format': 'json', 'generator': 'geosearch',
        'ggscoord': f'{latitude}|{longitude}', 'ggsradius': 10000, 'ggslimit': 10, 'ggsnamespace': 6,
        'prop': 'coordinates|imageinfo', 'coprimary': 'primary',
        'iiprop': 'url|extmetadata|mime', 'iiurlwidth': 900})
    candidates = []
    for page in data.get('query', {}).get('pages', {}).values():
        name = str(page.get('title', '')).removeprefix('File:')
        if not re.search(r'\.(jpe?g|webp)$', name, re.I) or re.search(r'flag|logo|locator|\bmap\b|coat.of.arms|seal|portrait|selfie', name.replace('_', ' '), re.I):
            continue
        coords = next((coord for coord in page.get('coordinates', []) if coord.get('primary') is not None and coord.get('globe', 'earth') == 'earth'), None)
        if not coords:
            continue
        lat, lon = float(coords['lat']), float(coords['lon'])
        other_country = country_at(lat, lon)
        distance = _distance(latitude, longitude, lat, lon)
        if distance > 10 or not other_country or other_country['code'] != country['code']:
            continue
        info = next(iter(page.get('imageinfo', [])), {})
        metadata = info.get('extmetadata', {})
        value = lambda key: _text(metadata.get(key, {}).get('value'))
        license_name = value('LicenseShortName')
        license_url = _url(metadata.get('LicenseUrl', {}).get('value'), {'creativecommons.org', 'www.creativecommons.org', 'commons.wikimedia.org'})
        image_url = _url(info.get('thumburl'), {'upload.wikimedia.org', 'thumb.wikimedia.org'})
        if image_url:
            # Both are official thumbnail hosts. Use the established upload host
            # and omit source-campaign tracking from image requests.
            image_url = image_url.replace('https://thumb.wikimedia.org/', 'https://upload.wikimedia.org/').split('?', 1)[0]
        source_url = _url(info.get('descriptionurl'), {'commons.wikimedia.org'})
        if (info.get('mime') not in ('image/jpeg', 'image/webp') or not image_url or not source_url or not license_url
                or not re.match(r'^(CC BY|CC0|Public domain)', license_name, re.I) or not value('Artist')):
            continue
        title = value('ObjectName') or name.rsplit('.', 1)[0].replace('_', ' ')
        candidates.append((distance, {'title': title[:160], 'distance_km': round(distance, 2), 'image_url': image_url,
                'file_title': name, 'source_url': source_url, 'author': value('Artist'),
                'license': license_name, 'license_url': license_url,
                'scope': 'Nearby place photograph, not a live view of your pin. Cropped for display.'}))
    return min(candidates, key=lambda item: item[0])[1] if candidates else None


def get_place(latitude, longitude):
    country = country_at(latitude, longitude)
    if not country:
        return {'status': 'outside_region', 'photo': None}
    key = f'place-v3:{latitude:.5f}:{longitude:.5f}'
    cached = cache.get(key)
    if cached:
        return cached
    result = {'status': 'unavailable', 'latitude': latitude, 'longitude': longitude,
              'country': country['name'], 'label': country['name'], 'photo': None,
              'fetched_at': timezone.now().isoformat(), 'address_status': 'unavailable', 'photo_status': 'unavailable'}
    try:
        address = _address(latitude, longitude, country)
        if address:
            result.update(address=address, label=address['label'], address_status='ok', status='ok')
    except (OSError, ValueError, TypeError, KeyError, AttributeError, OverflowError):
        pass
    try:
        photo = _nearby_photo(latitude, longitude, country)
        result.update(photo=photo, photo_status='ok' if photo else 'not_found')
        if photo:
            result['status'] = 'ok'
    except (OSError, ValueError, TypeError, KeyError, AttributeError, OverflowError):
        pass
    complete = result['address_status'] == 'ok' and result['photo_status'] != 'unavailable'
    cache.set(key, result, 2592000 if complete else 120)
    return result
