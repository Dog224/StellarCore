"""Dated, cached NASA POWER summaries for the saved field location."""
import json
import logging
import math
import threading
from datetime import timedelta
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import URLError

from django.core.cache import cache
from django.utils import timezone
from .weather_history import build_history

logger = logging.getLogger(__name__)
ENDPOINT = 'https://power.larc.nasa.gov/api/temporal/daily/point'
SOURCE_URL = 'https://power.larc.nasa.gov/'
_request_locks = [threading.Lock() for _ in range(16)]


def summarize_imerg(payload, start, end):
    """Keep IMERG independent of the POWER fallback and expose its own dates."""
    base = {'source': 'GPM IMERG via NASA POWER', 'parameter': 'IMERG_PRECTOT',
            'source_url': 'https://gpm.nasa.gov/data/imerg', 'resolution': '0.1° grid (~10 km)', 'time_standard': 'UTC'}
    units = payload.get('parameters', {}).get('IMERG_PRECTOT', {}).get('units')
    series = payload.get('properties', {}).get('parameter', {}).get('IMERG_PRECTOT', {})
    missing = payload.get('header', {}).get('fill_value', -999)
    if units not in ('mm', 'mm/day'):
        return {**base, 'status': 'unavailable'}
    last = end
    while last - timedelta(days=6) >= start:
        days = []
        for offset in range(6, -1, -1):
            day = last - timedelta(days=offset)
            value = series.get(day.strftime('%Y%m%d'))
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value == missing or value < 0:
                break
            days.append({'date': day.isoformat(), 'rainfall_mm': value})
        if len(days) == 7:
            age = (end + timedelta(days=2) - last).days
            return {**base, 'status': 'ok' if age <= 7 else 'stale', 'age_days': age,
                    'period_start': days[0]['date'], 'period_end': days[-1]['date'],
                    'rainfall_mm': round(sum(day['rainfall_mm'] for day in days), 2), 'days': days}
        last -= timedelta(days=1)
    return {**base, 'status': 'unavailable'}


def summarize(payload, start, end):
    """Use a complete, consecutive week; never turn missing rain into zero."""
    series = payload['properties']['parameter']
    units = payload['parameters']
    for name, expected in [('T2M', 'C'), ('PRECTOTCORR', 'mm/day'), ('RH2M', '%')]:
        if units[name]['units'] != expected:
            raise ValueError('Unexpected NASA parameter units')
    missing = payload.get('header', {}).get('fill_value', -999)

    def reading(parameter, key):
        value = series.get(parameter, {}).get(key)
        if isinstance(value, bool) or not isinstance(value, (float, int)):
            return None
        if value == missing or not math.isfinite(value):
            return None
        if parameter in ('PRECTOTCORR', 'WS2M') and value < 0:
            return None
        if parameter == 'RH2M' and not 0 <= value <= 100:
            return None
        if parameter in ('SFMC', 'RZMC', 'GWETTOP', 'GWETROOT') and not 0 <= value <= 1:
            return None
        return value

    def soil_reading(day):
        # Volumetric content and relative wetness are different physical quantities.
        for surface, root, unit, kind in [('SFMC', 'RZMC', 'm3 m-3', 'volumetric'),
                                           ('GWETTOP', 'GWETROOT', '1', 'wetness_index')]:
            if units.get(surface, {}).get('units') != unit:
                continue
            key = day.strftime('%Y%m%d')
            value = reading(surface, key)
            if value is not None:
                return {'status': 'ok', 'date': day.isoformat(), 'surface': value,
                        'root_zone': reading(root, key) if units.get(root, {}).get('units') == unit else None,
                        'kind': kind, 'units': 'm³/m³' if kind == 'volumetric' else '0–1',
                        'parameter': surface, 'root_parameter': root, 'source': 'NASA POWER',
                        'source_details': payload.get('header', {}).get('sources', [])}
        return None

    # Search back from the requested end, since NASA products have publication lag.
    last_day = end
    weather_start = max(start, end - timedelta(days=34))
    while last_day - timedelta(days=6) >= weather_start:
        week = []
        for offset in range(6, -1, -1):
            day = last_day - timedelta(days=offset)
            key = day.strftime('%Y%m%d')
            temperature, rain = reading('T2M', key), reading('PRECTOTCORR', key)
            if temperature is None or rain is None:
                break
            week.append({'date': day.isoformat(), 'temperature_c': temperature,
                         'rainfall_mm': rain, 'humidity_percent': reading('RH2M', key),
                         'wind_ms': reading('WS2M', key) if units.get('WS2M', {}).get('units') == 'm/s' else None,
                         'minimum_c': reading('T2M_MIN', key) if units.get('T2M_MIN', {}).get('units') == 'C' else None,
                         'maximum_c': reading('T2M_MAX', key) if units.get('T2M_MAX', {}).get('units') == 'C' else None,
                         'soil': soil_reading(day)})
        if len(week) == 7:
            humidity = [day['humidity_percent'] for day in week]
            # Prefer the latest valid soil day; show its own date if the week has gaps.
            soil_day = last_day
            soil = None
            while soil_day >= start and soil is None:
                soil = soil_reading(soil_day)
                soil_day -= timedelta(days=1)
            return {
                'period_start': week[0]['date'], 'period_end': week[-1]['date'],
                'rainfall_mm': round(sum(day['rainfall_mm'] for day in week), 2),
                'temperature_c': round(sum(day['temperature_c'] for day in week) / 7, 1),
                'humidity_percent': round(sum(humidity) / 7, 1) if all(v is not None for v in humidity) else None,
                'wind_ms': round(sum(day['wind_ms'] for day in week) / 7, 2) if all(day['wind_ms'] is not None for day in week) else None,
                'days': week, 'time_standard': 'UTC',
                'soil_moisture': soil or {'status': 'unavailable'},
                'imerg': summarize_imerg(payload, start, end),
            }
        last_day -= timedelta(days=1)
    raise ValueError('No complete week available')


def get_field_weather(field):
    base = {'source': 'NASA POWER', 'source_url': SOURCE_URL,
            'soil_moisture': None, 'forecast': False}
    if not field or field.latitude is None or field.longitude is None:
        return {**base, 'status': 'needs_location', 'message': 'Save your field pin to load NASA weather data.'}
    # Rounded coordinates share a cache entry while retaining useful point precision.
    latitude, longitude = round(float(field.latitude), 4), round(float(field.longitude), 4)
    today = timezone.localdate()
    key = f'power-v4-history:{latitude:.4f}:{longitude:.4f}:{today.isoformat()}'
    # The weekly card and history tab can arrive together; share one source read.
    with _request_locks[hash(key) % len(_request_locks)]:
        return _cached_weather(base, key, latitude, longitude, today)


def _cached_weather(base, key, latitude, longitude, today):
    cached = cache.get(key)
    if cached is not None:
        return cached
    end = today - timedelta(days=2)
    start = end - timedelta(days=99)
    params = {'parameters': 'T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,WS2M,RH2M,IMERG_PRECTOT,SFMC,RZMC,GWETTOP,GWETROOT', 'community': 'AG',
              'latitude': latitude, 'longitude': longitude, 'start': start.strftime('%Y%m%d'),
              'end': end.strftime('%Y%m%d'), 'format': 'JSON', 'time-standard': 'UTC'}
    try:
        request = Request(ENDPOINT + '?' + urlencode(params), headers={'User-Agent': 'TerraGrow/1.0', 'Accept': 'application/json'})
        with urlopen(request, timeout=15) as response:
            payload = json.load(response)
        fetched_at = timezone.now().isoformat()
        history = build_history(payload, start, end, today, fetched_at, request.full_url)
        try:
            summary = summarize(payload, start, end)
        except (ValueError, KeyError, TypeError):
            if history['status'] != 'ok':
                raise
            result = {**base, 'status': 'unavailable', 'history': history,
                      'message': 'No complete recent week is available. Check the dated weather history instead.'}
            cache.set(key, result, 120)
            return result
        result = {**base, **summary, 'status': 'ok', 'latitude': latitude, 'longitude': longitude,
                  'fetched_at': fetched_at, 'history': history,
                  'message': 'NASA POWER gridded estimates, not on-field sensor readings or a forecast.'}
        cache.set(key, result, 6 * 60 * 60)
        return result
    except (URLError, TimeoutError, OSError, ValueError, KeyError, TypeError):
        logger.warning('NASA POWER weather request unavailable')
        result = {**base, 'status': 'unavailable',
                  'message': 'NASA data is temporarily unavailable or incomplete. Please try again in a few minutes.'}
        cache.set(key, result, 120)
        return result
