import json
from datetime import date, timedelta
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import URLError

from django.core.cache import cache
from django.test import TestCase

from .models import Field
from .nasa_power import get_field_weather, summarize


def sample_payload():
    days = [(date(2026, 11, 6) + timedelta(days=i)).strftime('%Y%m%d') for i in range(7)]
    return {
        'header': {'fill_value': -999},
        'parameters': {'T2M': {'units': 'C'}, 'PRECTOTCORR': {'units': 'mm/day'}, 'RH2M': {'units': '%'}},
        'properties': {'parameter': {
            'T2M': dict.fromkeys(days, 28),
            'PRECTOTCORR': dict.fromkeys(days, 0),
            'RH2M': dict.fromkeys(days, 80),
        }},
    }


class NasaPowerTests(TestCase):
    def setUp(self):
        cache.clear()
        self.field = SimpleNamespace(latitude=13.7563, longitude=100.5018)
        self.addCleanup(cache.clear)

    def test_summary_keeps_zero_rain_and_averages_full_week(self):
        result = summarize(sample_payload(), date(2026, 11, 1), date(2026, 11, 12))
        self.assertEqual(result['rainfall_mm'], 0)
        self.assertEqual(result['temperature_c'], 28)
        self.assertEqual(result['humidity_percent'], 80)
        self.assertEqual(len(result['days']), 7)

    def test_missing_or_invalid_rain_is_not_counted_as_zero(self):
        for bad in [-999, -1, None, float('nan')]:
            payload = sample_payload()
            payload['properties']['parameter']['PRECTOTCORR']['20261109'] = bad
            with self.assertRaises(ValueError):
                summarize(payload, date(2026, 11, 1), date(2026, 11, 12))

    def test_incomplete_humidity_is_not_averaged_as_full_week(self):
        payload = sample_payload()
        payload['properties']['parameter']['RH2M']['20261109'] = -999
        result = summarize(payload, date(2026, 11, 1), date(2026, 11, 12))
        self.assertIsNone(result['humidity_percent'])
        self.assertEqual(result['temperature_c'], 28)

    def test_unexpected_units_are_rejected(self):
        payload = sample_payload()
        payload['parameters']['PRECTOTCORR']['units'] = 'inches'
        with self.assertRaises(ValueError):
            summarize(payload, date(2026, 11, 1), date(2026, 11, 12))

    def test_soil_model_index_fallback_is_labeled_and_keeps_zero(self):
        payload = sample_payload()
        series = payload['properties']['parameter']
        for name, value in [('SFMC', -999), ('RZMC', -999), ('GWETTOP', 0), ('GWETROOT', .74)]:
            payload['parameters'][name] = {'units': 'm3 m-3' if name in ('SFMC', 'RZMC') else '1'}
            series[name] = dict.fromkeys(series['T2M'], value)
        result = summarize(payload, date(2026, 11, 1), date(2026, 11, 12))
        soil = result['soil_moisture']
        self.assertEqual(soil['surface'], 0)
        self.assertEqual(soil['root_zone'], .74)
        self.assertEqual(soil['kind'], 'wetness_index')
        self.assertEqual(soil['date'], '2026-11-12')
        self.assertEqual(result['days'][0]['soil']['kind'], 'wetness_index')

    def test_volumetric_soil_has_distinct_units_and_precedence(self):
        payload = sample_payload()
        series = payload['properties']['parameter']
        for name, value in [('SFMC', .25), ('RZMC', .32), ('GWETTOP', .8), ('GWETROOT', .9)]:
            payload['parameters'][name] = {'units': 'm3 m-3' if name in ('SFMC', 'RZMC') else '1'}
            series[name] = dict.fromkeys(series['T2M'], value)
        soil = summarize(payload, date(2026, 11, 1), date(2026, 11, 12))['soil_moisture']
        self.assertEqual(soil['surface'], .25)
        self.assertEqual(soil['kind'], 'volumetric')
        self.assertEqual(soil['units'], 'm³/m³')

    def test_soil_failure_does_not_hide_weather(self):
        result = summarize(sample_payload(), date(2026, 11, 1), date(2026, 11, 12))
        self.assertEqual(result['soil_moisture']['status'], 'unavailable')
        self.assertEqual(result['temperature_c'], 28)

    def test_soil_uses_own_date_and_does_not_relabel_invalid_values(self):
        payload = sample_payload()
        payload['parameters']['GWETTOP'] = {'units': '1'}
        payload['properties']['parameter']['GWETTOP'] = {'20261112': -999, '20261111': 1.2, '20261110': .67}
        result = summarize(payload, date(2026, 11, 1), date(2026, 11, 12))
        self.assertEqual(result['soil_moisture']['date'], '2026-11-10')
        self.assertEqual(result['soil_moisture']['surface'], .67)
        self.assertIsNone(result['soil_moisture']['root_zone'])

    @patch('website.nasa_power.urlopen')
    def test_no_location_makes_no_external_request(self, fetch):
        self.assertEqual(get_field_weather(None)['status'], 'needs_location')
        self.assertEqual(get_field_weather(SimpleNamespace(latitude=None, longitude=None))['status'], 'needs_location')
        fetch.assert_not_called()

    @patch('website.nasa_power.timezone.localdate', return_value=date(2026, 11, 14))
    @patch('website.nasa_power.urlopen')
    def test_success_is_cached_and_pin_changes_fetch_new_data(self, fetch, today):
        fetch.side_effect = lambda *args, **kwargs: BytesIO(json.dumps(sample_payload()).encode())
        result = get_field_weather(self.field)
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(get_field_weather(self.field), result)
        self.assertEqual(fetch.call_count, 1)
        self.assertIn('community=AG', fetch.call_args.args[0].full_url)
        self.assertIn('time-standard=UTC', fetch.call_args.args[0].full_url)
        self.field.latitude = 14.1
        get_field_weather(self.field)
        self.assertEqual(fetch.call_count, 2)

    @patch('website.nasa_power.urlopen', side_effect=URLError('timeout'))
    def test_failure_is_cached_without_fabricated_values(self, fetch):
        result = get_field_weather(self.field)
        self.assertEqual(result['status'], 'unavailable')
        self.assertNotIn('rainfall_mm', result)
        self.assertEqual(get_field_weather(self.field), result)
        self.assertEqual(fetch.call_count, 1)

    @patch('website.nasa_power.urlopen', return_value=BytesIO(b'not-json'))
    def test_invalid_api_response_is_handled(self, fetch):
        self.assertEqual(get_field_weather(self.field)['status'], 'unavailable')

    def test_weather_endpoint_without_pin(self):
        response = self.client.get('/api/weather/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'needs_location')
        self.assertEqual(self.client.post('/api/weather/').status_code, 405)

    @patch('website.views.get_field_weather')
    def test_weather_endpoint_uses_saved_field(self, service):
        field = Field.objects.first()
        field.latitude, field.longitude = '14.1', '100.2'
        field.save()
        service.return_value = {'status': 'ok', 'source': 'NASA POWER', 'rainfall_mm': 9}
        response = self.client.get('/api/weather/?latitude=0&longitude=0')
        self.assertEqual(response.json()['rainfall_mm'], 9)
        self.assertEqual(float(service.call_args.args[0].latitude), 14.1)
