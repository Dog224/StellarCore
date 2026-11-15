"""Read live POWER history at three Lao locations without changing saved pins."""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'stellas.settings')
import django
django.setup()
from django.utils import timezone
from website.weather_history import get_history


def check(task):
    name, latitude, longitude, period = task
    result = get_history(SimpleNamespace(latitude=latitude, longitude=longitude), period)
    assert result['status'] == 'ok', (task, result)
    assert not result['forecast']
    for key in ('rainfall_mm', 'temperature_c', 'maximum_c', 'minimum_c', 'wind_ms', 'soil_surface'):
        assert result['coverage'][key]['valid_days'] > 0, (task, key)
    assert result['summary']['observed_rainfall_mm'] == round(sum(row['rainfall_mm'] for row in result['days'] if row['rainfall_mm'] is not None), 2)
    return {'place': name, 'latitude': latitude, 'longitude': longitude, 'period': period,
            **{key: result[key] for key in ('source_url', 'source_products', 'fetched_at', 'requested_start', 'requested_end', 'coverage', 'summary', 'changes', 'soil')},
            'returned_days': len(result['days']), 'returned_months': len(result['months'])}


def main():
    tasks = [(name, lat, lon, period) for name, lat, lon in [('Vientiane',18,102.6),('Paksong',15.18,106.23),('Phongsaly',21.68,102.1)] for period in ('100d','5y')]
    tasks += [('Vientiane',18,102.6,'1y'),('Vientiane',18,102.6,'10y')]
    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(check, tasks))
    recent = [row for row in results if row['period'] == '100d']
    assert len({(row['summary']['observed_rainfall_mm'], row['summary']['temperature_c'], row['summary']['wind_ms']) for row in recent}) == 3
    directory = ROOT / 'reports'
    directory.mkdir(exist_ok=True)
    (directory / 'weather-history-validation.json').write_text(json.dumps({'validated_at':timezone.now().isoformat(),'source':'Live NASA POWER requests; no fixtures and no database writes','results':results},ensure_ascii=False,indent=2),encoding='utf-8')
    lines = ['# Live weather-history validation', '', 'All values below came from NASA POWER API calls. No saved field was changed.', '', '| Place | Period | Dates | Days | Observed rain mm | Mean °C | Mean wind m/s | Soil type |', '|---|---|---|---:|---:|---:|---:|---|']
    for row in results:
        s = row['summary']
        lines.append(f"| {row['place']} | {row['period']} | {row['requested_start']} – {row['requested_end']} | {row['returned_days']} | {s['observed_rainfall_mm']} | {s['temperature_c']} | {s['wind_ms']} | {row['soil']['kind']} |")
    (directory / 'weather-history-validation.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
