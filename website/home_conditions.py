"""Small pin-specific home cards, independent of historical NASA requests."""
import json
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone as utc
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.cache.backends.filebased import FileBasedCache
from django.utils import timezone

from .crop_environment import pin_id
from .region import contains_location

WEATHER = 'https://api.open-meteo.com/v1/forecast'
AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality'
cache = FileBasedCache(str(settings.BASE_DIR / '.home_cache'), {'TIMEOUT': 900, 'OPTIONS': {'MAX_ENTRIES': 1000}})


def read_source(url, params):
    with urlopen(Request(url + '?' + urlencode(params), headers={'User-Agent': 'MekongRise/1.0 home conditions'}), timeout=7) as response:
        body = response.read(250001)
    if len(body) > 250000:
        raise ValueError('Source response too large')
    return json.loads(body)


def number(value, low=-float('inf'), high=float('inf')):
    return value if isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) and low <= value <= high else None


def sample_time(value, max_age):
    stamp = datetime.fromisoformat(value).replace(tzinfo=utc.utc)
    age = (timezone.now() - stamp).total_seconds()
    return value + 'Z', 'ok' if -3600 <= age <= max_age else 'stale'


def weather_summary(payload):
    units, current = payload['current_units'], payload['current']
    if units.get('temperature_2m') != '°C' or units.get('relative_humidity_2m') != '%' or units.get('wind_speed_10m') != 'km/h':
        raise ValueError('Unexpected weather units')
    stamp, status = sample_time(current['time'], 7200)
    result = {'status': status, 'time': stamp, 'temperature_c': number(current.get('temperature_2m'), -100, 70),
              'humidity_percent': number(current.get('relative_humidity_2m'), 0, 100),
              'wind_kmh': number(current.get('wind_speed_10m'), 0), 'code': number(current.get('weather_code'), 0, 99),
              'source': 'Open-Meteo weather models', 'source_url': 'https://open-meteo.com/en/docs'}
    if result['temperature_c'] is None:
        result['status'] = 'unavailable'
    rain = {'status': 'unavailable', 'dry_days': None, 'rainfall_mm': None}
    if payload.get('daily_units', {}).get('precipitation_sum') == 'mm':
        daily = payload.get('daily', {})
        days, values = daily.get('time', []), daily.get('precipitation_sum', [])
        today = timezone.now().date()
        expected = [(today - timedelta(days=offset)).isoformat() for offset in range(7, 0, -1)]
        readings = dict(zip(days, values)) if len(days) == len(values) else {}
        valid = [number(readings.get(day), 0) for day in expected]
        if all(value is not None for value in valid):
            rain.update(status='ok', dry_days=sum(value < 1 for value in valid), rainfall_mm=round(sum(valid), 1),
                        period_start=expected[0], period_end=expected[-1], threshold_mm=1)
    return result, rain


def air_summary(payload):
    units, current = payload['current_units'], payload['current']
    if units.get('pm2_5') not in ('μg/m³', 'µg/m³') or units.get('us_aqi') != 'USAQI':
        raise ValueError('Unexpected air-quality units')
    stamp, status = sample_time(current['time'], 21600)
    aqi = number(current.get('us_aqi'), 0)
    label = next((label for ceiling, label in [(50, 'Good'), (100, 'Moderate'), (150, 'Unhealthy for sensitive groups'),
        (200, 'Unhealthy'), (300, 'Very unhealthy'), (float('inf'), 'Hazardous')] if aqi is not None and aqi <= ceiling), None)
    return {'status': status, 'time': stamp, 'pm25': number(current.get('pm2_5'), 0), 'aqi': aqi, 'level': label,
            'source': 'CAMS global via Open-Meteo', 'source_url': 'https://open-meteo.com/en/docs/air-quality-api',
            'resolution': 'Approximately 45 km model grid'}


def get_conditions(field, refresh=False):
    if not field or field.latitude is None or field.longitude is None:
        return {'status': 'needs_location'}
    latitude, longitude = float(field.latitude), float(field.longitude)
    if not contains_location(latitude, longitude):
        return {'status': 'outside_region'}
    key = 'home-v1:' + pin_id(field)
    cached = cache.get(key)
    retry_allowed = refresh and cached and cached.get('status') != 'ok' and cache.add(key + ':retry', True, 30)
    if cached and not retry_allowed:
        return cached
    result = {'status': 'unavailable', 'latitude': latitude, 'longitude': longitude, 'pin': pin_id(field),
              'weather': {'status': 'unavailable'}, 'rain': {'status': 'unavailable'}, 'air': {'status': 'unavailable'},
              'fetched_at': timezone.now().isoformat()}
    params = {'latitude': latitude, 'longitude': longitude, 'timezone': 'GMT', 'forecast_days': 1}
    with ThreadPoolExecutor(max_workers=2) as pool:
        weather = pool.submit(read_source, WEATHER, {**params, 'current': 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
            'daily': 'precipitation_sum', 'wind_speed_unit': 'kmh', 'past_days': 7})
        air = pool.submit(read_source, AIR, {**params, 'current': 'pm2_5,us_aqi', 'domains': 'cams_global'})
        try:
            result['weather'], result['rain'] = weather_summary(weather.result())
        except (OSError, ValueError, TypeError, KeyError, AttributeError):
            pass
        try:
            result['air'] = air_summary(air.result())
        except (OSError, ValueError, TypeError, KeyError, AttributeError):
            pass
    statuses = [result[key]['status'] for key in ('weather', 'air')]
    result['status'] = 'ok' if all(status == 'ok' for status in statuses) else 'partial' if 'ok' in statuses else 'unavailable'
    cache.set(key, result, 900 if result['status'] == 'ok' else 120)
    return result
