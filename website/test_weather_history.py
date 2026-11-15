import json
from datetime import date, timedelta
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import URLError

from django.core.cache import cache
from django.test import SimpleTestCase, TestCase

from .models import Field
from .weather_history import build_history, get_history, period_dates


def payload(start, count):
    dates = [(start + timedelta(days=i)).strftime('%Y%m%d') for i in range(count)]
    values = {'T2M': (25, 'C'), 'T2M_MAX': (31, 'C'), 'T2M_MIN': (19, 'C'),
              'PRECTOTCORR': (2, 'mm/day'), 'WS2M': (1.5, 'm/s'), 'RH2M': (75, '%'),
              'GWETTOP': (.65, '1'), 'GWETROOT': (.72, '1'), 'SFMC': (-999, 'm3 m-3'), 'RZMC': (-999, 'm3 m-3')}
    return {'header': {'fill_value': -999, 'sources': ['MERRA2', 'POWER']},
            'parameters': {key: {'units': unit} for key, (_, unit) in values.items()},
            'properties': {'parameter': {key: dict.fromkeys(dates, value) for key, (value, _) in values.items()}}}


def report(raw, start, end):
    return build_history(raw, start, end, end + timedelta(days=2), '2026-11-15T01:00:00Z', 'https://power.larc.nasa.gov/api/temporal/daily/point?test=1')


class HistoryCalculationTests(SimpleTestCase):
    def test_periods_have_explicit_rolling_or_complete_year_scope(self):
        today = date(2026, 11, 15)
        self.assertEqual(period_dates('100d', today), (date(2026, 8, 6), date(2026, 11, 13)))
        start, end = period_dates('1y', today)
        self.assertEqual((end - start).days + 1, 365)
        self.assertEqual(period_dates('5y', today), (date(2021, 1, 1), date(2025, 12, 31)))
        self.assertEqual(period_dates('10y', today), (date(2016, 1, 1), date(2025, 12, 31)))
        with self.assertRaises(ValueError):
            period_dates('100y', today)

    def test_real_zero_values_are_retained_with_all_four_temperature_and_rain_fields(self):
        raw = payload(date(2025, 1, 1), 4)
        for name in ('PRECTOTCORR', 'WS2M', 'GWETTOP'):
            raw['properties']['parameter'][name] = dict.fromkeys(raw['properties']['parameter'][name], 0)
        result = report(raw, date(2025, 1, 1), date(2025, 1, 4))
        self.assertEqual(result['summary']['rainfall_mm'], 0)
        self.assertEqual(result['summary']['wind_ms'], 0)
        self.assertEqual(result['summary']['latest_soil']['soil_surface'], 0)
        self.assertEqual(result['summary']['hottest_day']['maximum_c'], 31)
        self.assertEqual(result['summary']['coldest_day']['minimum_c'], 19)
        self.assertEqual(result['summary']['longest_observed_dry_spell_days'], 4)
        self.assertFalse(result['forecast'])

    def test_missing_rain_is_not_zero_or_a_complete_month_or_year(self):
        raw = payload(date(2025, 1, 1), 365)
        raw['properties']['parameter']['PRECTOTCORR']['20250102'] = -999
        result = report(raw, date(2025, 1, 1), date(2025, 12, 31))
        self.assertIsNone(result['days'][1]['rainfall_mm'])
        self.assertEqual(result['coverage']['rainfall_mm']['valid_days'], 364)
        self.assertIsNone(result['summary']['rainfall_mm'])
        self.assertEqual(result['summary']['observed_rainfall_mm'], 728)
        self.assertIsNone(result['months'][0]['rainfall_mm'])
        self.assertIsNone(result['years'][0]['rainfall_mm'])
        self.assertEqual(result['seasonality'][0]['years'], 0)
        self.assertIsNone(result['changes']['rainfall_mm'])

    def test_missing_day_breaks_observed_dry_spell(self):
        raw = payload(date(2025, 1, 1), 6)
        raw['properties']['parameter']['PRECTOTCORR'] = {'20250101': 0, '20250102': 0, '20250103': -999, '20250104': 0, '20250105': .4, '20250106': 2}
        result = report(raw, date(2025, 1, 1), date(2025, 1, 6))
        self.assertEqual(result['summary']['longest_observed_dry_spell_days'], 2)
        self.assertEqual(result['summary']['rainy_day_frequency_percent'], 20)

    def test_soil_quantities_are_never_mixed_or_relabelled(self):
        raw = payload(date(2025, 1, 1), 4)
        result = report(raw, date(2025, 1, 1), date(2025, 1, 4))
        self.assertEqual(result['soil']['kind'], 'wetness_index')
        self.assertEqual(result['soil']['surface_parameter'], 'GWETTOP')
        raw['properties']['parameter']['SFMC']['20250103'] = .23
        result = report(raw, date(2025, 1, 1), date(2025, 1, 4))
        self.assertEqual(result['soil']['kind'], 'volumetric')
        self.assertEqual(result['soil']['units'], 'm³/m³')
        self.assertEqual(result['days'][2]['soil_surface'], .23)
        self.assertIsNone(result['days'][0]['soil_surface'])
        self.assertIsNone(result['days'][2]['soil_root'])
        self.assertEqual(result['summary']['latest_soil']['date'], '2025-01-03')

    def test_wrong_units_invalid_physical_values_and_boolean_are_missing(self):
        raw = payload(date(2025, 1, 1), 2)
        raw['parameters']['WS2M']['units'] = 'km/h'
        raw['properties']['parameter']['PRECTOTCORR'] = {'20250101': -1, '20250102': True}
        raw['properties']['parameter']['GWETTOP']['20250101'] = 1.2
        raw['properties']['parameter']['RH2M']['20250101'] = 101
        raw['properties']['parameter']['T2M_MAX']['20250101'] = 10
        result = report(raw, date(2025, 1, 1), date(2025, 1, 2))
        self.assertEqual(result['coverage']['wind_ms']['valid_days'], 0)
        self.assertEqual(result['coverage']['rainfall_mm']['valid_days'], 0)
        self.assertIsNone(result['days'][0]['soil_surface'])
        self.assertIsNone(result['days'][0]['humidity_percent'])
        self.assertIsNone(result['days'][0]['maximum_c'])
        self.assertIsNone(result['summary']['observed_rainfall_mm'])

    def test_leap_years_complete_monthly_patterns_and_period_changes(self):
        start, end = date(2023, 1, 1), date(2025, 12, 31)
        raw = payload(start, (end - start).days + 1)
        for day in list(raw['properties']['parameter']['T2M']):
            if day.startswith('2025'):
                raw['properties']['parameter']['T2M'][day] = 26
        result = report(raw, start, end)
        self.assertEqual([year['days'] for year in result['years']], [365, 366, 365])
        self.assertEqual(result['seasonality'][1]['years'], 3)
        self.assertAlmostEqual(result['seasonality'][1]['rainfall_mm'], 56.667)
        self.assertEqual(result['changes']['temperature_c'], 1)
        self.assertEqual(result['changes']['rainfall_mm'], 0)
        self.assertEqual(result['source_products'], ['MERRA2', 'POWER'])
        self.assertEqual(result['coverage']['maximum_c']['parameter'], 'T2M_MAX')

    def test_no_valid_days_has_no_fake_data(self):
        result = report({'properties': {'parameter': {}}, 'parameters': {}}, date(2025, 1, 1), date(2025, 1, 3))
        self.assertEqual(result['status'], 'unavailable')
        self.assertIsNone(result['latest_date'])
        self.assertIsNone(result['summary']['rainy_day_frequency_percent'])


class HistoryServiceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.field = SimpleNamespace(latitude=18, longitude=102.6)

    @patch('website.weather_history.urlopen')
    def test_no_pin_and_invalid_period_make_no_source_request(self, fetch):
        self.assertEqual(get_history(None)['status'], 'needs_location')
        self.assertEqual(self.client.get('/api/weather/history/?period=200y').status_code, 400)
        self.assertEqual(self.client.post('/api/weather/history/').status_code, 405)
        fetch.assert_not_called()

    @patch('website.nasa_power.get_field_weather')
    def test_100_days_reuses_the_weekly_source_read(self, service):
        service.return_value = {'status': 'ok', 'history': {'status': 'ok', 'days': [{'date': '2026-11-12'}]}}
        self.assertEqual(get_history(self.field)['days'], [{'date': '2026-11-12'}])
        service.assert_called_once_with(self.field)

    @patch('website.weather_history.timezone.localdate', return_value=date(2026, 11, 15))
    @patch('website.weather_history.urlopen')
    def test_source_parameters_period_cache_and_location(self, fetch, today):
        raw = payload(date(2025, 1, 1), 365)
        fetch.side_effect = lambda *args, **kwargs: BytesIO(json.dumps(raw).encode())
        first = get_history(self.field, '5y')
        self.assertEqual(first['status'], 'ok')
        self.assertIn('start=20210101', first['source_url'])
        self.assertIn('end=20251231', first['source_url'])
        self.assertIn('T2M_MAX', first['source_url'])
        self.assertIn('WS2M', first['source_url'])
        self.assertIn('GWETROOT', first['source_url'])
        self.assertEqual(get_history(self.field, '5y'), first)
        self.assertEqual(fetch.call_count, 1)
        self.field.latitude = 15.18
        get_history(self.field, '5y')
        self.assertEqual(fetch.call_count, 2)

    @patch('website.weather_history.urlopen', side_effect=URLError('offline'))
    def test_failure_has_no_placeholder_results(self, fetch):
        result = get_history(self.field, '1y')
        self.assertEqual(result['status'], 'unavailable')
        self.assertNotIn('summary', result)
        self.assertEqual(get_history(self.field, '1y'), result)
        self.assertEqual(fetch.call_count, 1)

    @patch('website.views.get_history')
    def test_endpoint_uses_saved_pin_and_discards_data_after_pin_change(self, service):
        field = Field.objects.first()
        field.latitude, field.longitude = 18, 102.6
        field.save()
        service.return_value = {'status': 'ok', 'days': []}
        response = self.client.get('/api/weather/history/?latitude=0&longitude=0&period=5y')
        self.assertEqual(response.json()['latitude'], 18)
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertEqual(float(service.call_args.args[0].longitude), 102.6)
        def changed(*args):
            Field.objects.filter(pk=field.pk).update(latitude=15.18, longitude=106.23)
            return {'status': 'ok'}
        service.side_effect = changed
        self.assertEqual(self.client.get('/api/weather/history/').status_code, 409)
