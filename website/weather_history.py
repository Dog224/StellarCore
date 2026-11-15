"""Descriptive weather history from POWER; missing days never become dry days."""
import calendar
import hashlib
import json
import math
from collections import defaultdict
from datetime import date, timedelta
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.core.cache import cache
from django.utils import timezone

ENDPOINT = 'https://power.larc.nasa.gov/api/temporal/daily/point'
PARAMETERS = {
    'rainfall_mm': ('PRECTOTCORR', 'mm/day'), 'temperature_c': ('T2M', 'C'),
    'maximum_c': ('T2M_MAX', 'C'), 'minimum_c': ('T2M_MIN', 'C'),
    'wind_ms': ('WS2M', 'm/s'), 'humidity_percent': ('RH2M', '%'),
    'surface_volumetric': ('SFMC', 'm3 m-3'), 'root_volumetric': ('RZMC', 'm3 m-3'),
    'surface_wetness': ('GWETTOP', '1'), 'root_wetness': ('GWETROOT', '1'),
}
PERIODS = {'100d', '1y', '5y', '10y'}


def period_dates(period, today):
    if period not in PERIODS:
        raise ValueError('Unsupported history period')
    end = today - timedelta(days=2)
    if period in ('5y', '10y'):
        years = 5 if period == '5y' else 10
        return date(today.year - years, 1, 1), date(today.year - 1, 12, 31)
    return end - timedelta(days=99 if period == '100d' else 364), end


def mean(values):
    known = [value for value in values if value is not None]
    return round(sum(known) / len(known), 3) if known else None


def complete_total(values):
    return round(sum(values), 2) if values and all(value is not None for value in values) else None


def build_history(payload, start, end, today, fetched_at, source_url):
    series = payload['properties']['parameter']
    metadata = payload.get('parameters', {})
    if not isinstance(series, dict) or not isinstance(metadata, dict):
        raise ValueError('Invalid POWER series')
    fill = payload.get('header', {}).get('fill_value', -999)

    def reading(name, key):
        parameter, unit = PARAMETERS[name]
        if metadata.get(parameter, {}).get('units') != unit:
            return None
        values = series.get(parameter, {})
        if not isinstance(values, dict):
            return None
        value = values.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value == fill:
            return None
        if name in ('rainfall_mm', 'wind_ms') and value < 0:
            return None
        if name == 'humidity_percent' and not 0 <= value <= 100:
            return None
        if name.endswith(('volumetric', 'wetness')) and not 0 <= value <= 1:
            return None
        return value

    days = []
    day = start
    while day <= end:
        row = {'date': day.isoformat(), **{name: reading(name, day.strftime('%Y%m%d')) for name in PARAMETERS}}
        if row['minimum_c'] is not None and row['maximum_c'] is not None and row['minimum_c'] > row['maximum_c']:
            row['minimum_c'] = row['maximum_c'] = None
        days.append(row)
        day += timedelta(days=1)
    # Never splice quantities with different units into the same line.
    volumetric = any(row['surface_volumetric'] is not None or row['root_volumetric'] is not None for row in days)
    kind = 'volumetric' if volumetric else 'wetness'
    for row in days:
        row['soil_surface'] = row['surface_' + kind]
        row['soil_root'] = row['root_' + kind]
        for name in ('surface_volumetric', 'root_volumetric', 'surface_wetness', 'root_wetness'):
            row.pop(name)

    names = ['rainfall_mm', 'temperature_c', 'maximum_c', 'minimum_c', 'wind_ms', 'humidity_percent', 'soil_surface', 'soil_root']
    coverage = {}
    for name in names:
        valid = [row['date'] for row in days if row[name] is not None]
        parameter = PARAMETERS[name][0] if name in PARAMETERS else ('SFMC' if volumetric else 'GWETTOP') if name == 'soil_surface' else ('RZMC' if volumetric else 'GWETROOT')
        coverage[name] = {'valid_days': len(valid), 'expected_days': len(days), 'missing_days': len(days) - len(valid),
                          'first_date': valid[0] if valid else None, 'last_date': valid[-1] if valid else None,
                          'parameter': parameter, 'source_units': metadata.get(parameter, {}).get('units')}

    def aggregate(rows):
        rain = [row['rainfall_mm'] for row in rows]
        observed = [value for value in rain if value is not None]
        return {'rainfall_mm': complete_total(rain), 'observed_rainfall_mm': round(sum(observed), 2) if observed else None,
                'rain_valid_days': len(observed), 'days': len(rows), 'rainy_days': sum(value >= 1 for value in observed),
                **{name: mean([row[name] for row in rows]) for name in names if name != 'rainfall_mm'}}

    monthly_groups, yearly_groups = defaultdict(list), defaultdict(list)
    for row in days:
        monthly_groups[row['date'][:7]].append(row)
        yearly_groups[row['date'][:4]].append(row)
    months = [{'date': key + '-01', **aggregate(rows),
               'complete_calendar_month': len(rows) == calendar.monthrange(int(key[:4]), int(key[5:]))[1]}
              for key, rows in monthly_groups.items()]
    years = [{'year': int(key), **aggregate(rows), 'complete_calendar_year': len(rows) == (366 if calendar.isleap(int(key)) else 365)}
             for key, rows in yearly_groups.items()]
    seasonality = []
    for month in range(1, 13):
        matching = [row for row in months if int(row['date'][5:7]) == month and row['complete_calendar_month'] and row['rainfall_mm'] is not None]
        seasonality.append({'month': month, 'years': len(matching), 'rainfall_mm': mean([row['rainfall_mm'] for row in matching])})

    valid_rain = [row for row in days if row['rainfall_mm'] is not None]
    valid_temp = [row for row in days if row['maximum_c'] is not None]
    valid_min = [row for row in days if row['minimum_c'] is not None]
    soil_days = [row for row in days if row['soil_surface'] is not None or row['soil_root'] is not None]
    dry_length, longest_dry = 0, 0
    for row in days:
        dry_length = dry_length + 1 if row['rainfall_mm'] is not None and row['rainfall_mm'] < 1 else 0
        longest_dry = max(longest_dry, dry_length)
    summary = aggregate(days)
    summary.update({'rainy_day_frequency_percent': round(100 * summary['rainy_days'] / len(valid_rain), 1) if valid_rain else None,
                    'longest_observed_dry_spell_days': longest_dry if valid_rain else None,
                    'hottest_day': max(valid_temp, key=lambda row: row['maximum_c']) if valid_temp else None,
                    'coldest_day': min(valid_min, key=lambda row: row['minimum_c']) if valid_min else None,
                    'wettest_day': max(valid_rain, key=lambda row: row['rainfall_mm']) if valid_rain else None,
                    'latest_soil': soil_days[-1] if soil_days else None})
    if len(years) >= 3 and years[0]['complete_calendar_year'] and years[-1]['complete_calendar_year']:
        earlier = [row for row in days if row['date'].startswith(str(years[0]['year']))]
        later = [row for row in days if row['date'].startswith(str(years[-1]['year']))]
    else:
        half = len(days) // 2
        earlier, later = days[:half], days[-half:]
    changes = {'earlier_start': earlier[0]['date'], 'earlier_end': earlier[-1]['date'],
               'later_start': later[0]['date'], 'later_end': later[-1]['date']}
    for name in ('rainfall_mm', 'temperature_c', 'wind_ms', 'soil_surface'):
        before, after = [row[name] for row in earlier], [row[name] for row in later]
        if all(value is not None for value in before + after):
            a = complete_total(before) if name == 'rainfall_mm' else mean(before)
            b = complete_total(after) if name == 'rainfall_mm' else mean(after)
            changes[name] = round(b - a, 3)
        else:
            changes[name] = None
    latest = max((item['last_date'] for item in coverage.values() if item['last_date']), default=None)
    return {'status': 'ok' if latest else 'unavailable', 'forecast': False, 'source': 'NASA POWER',
            'source_url': source_url, 'documentation_url': 'https://power.larc.nasa.gov/docs/services/api/temporal/daily/',
            'soil_documentation_url': 'https://power.larc.nasa.gov/docs/methodology/data/sources_hydrology/',
            'source_products': payload.get('header', {}).get('sources', []),
            'fetched_at': fetched_at, 'requested_start': start.isoformat(), 'requested_end': end.isoformat(),
            'latest_date': latest, 'age_days': (today - date.fromisoformat(latest)).days if latest else None,
            'end_gap_days': max(0, (end - date.fromisoformat(latest)).days) if latest else None,
            'time_standard': 'UTC', 'coverage': coverage, 'summary': summary, 'changes': changes,
            'soil': {'kind': 'volumetric' if volumetric else 'wetness_index', 'units': 'm³/m³' if volumetric else '0–1',
                     'surface_parameter': 'SFMC' if volumetric else 'GWETTOP', 'root_parameter': 'RZMC' if volumetric else 'GWETROOT'},
            'days': days, 'months': months, 'years': years, 'seasonality': seasonality}


def get_history(field, period='100d'):
    if period not in PERIODS:
        raise ValueError('Unsupported history period')
    if not field or field.latitude is None or field.longitude is None:
        return {'status': 'needs_location', 'forecast': False}
    if period == '100d':
        from .nasa_power import get_field_weather
        weather = get_field_weather(field)
        return {**weather.get('history', {'status': weather['status']}), 'period': period}
    today = timezone.localdate()
    start, end = period_dates(period, today)
    point = f'{float(field.latitude):.7f},{float(field.longitude):.7f}'
    key = 'weather-history-v1-' + hashlib.sha256(f'{point}:{start}:{end}'.encode()).hexdigest()
    cached = cache.get(key)
    if cached is not None:
        return cached
    args = {'parameters': ','.join(parameter for parameter, _ in PARAMETERS.values()), 'community': 'AG',
            'latitude': float(field.latitude), 'longitude': float(field.longitude),
            'start': start.strftime('%Y%m%d'), 'end': end.strftime('%Y%m%d'), 'format': 'JSON', 'time-standard': 'UTC'}
    source_url = ENDPOINT + '?' + urlencode(args)
    try:
        with urlopen(Request(source_url, headers={'User-Agent': 'TerraGrow weather history', 'Accept': 'application/json'}), timeout=30) as response:
            raw = response.read(4_000_001)
        if len(raw) > 4_000_000:
            raise ValueError('Response size exceeded')
        result = {**build_history(json.loads(raw), start, end, today, timezone.now().isoformat(), source_url), 'period': period}
    except (URLError, TimeoutError, OSError, ValueError, KeyError, TypeError):
        result = {'status': 'unavailable', 'period': period, 'forecast': False}
    cache.set(key, result, 86400 if result['status'] == 'ok' else 120)
    return result
