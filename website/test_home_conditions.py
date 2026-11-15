"""Source-contract fixtures for the redesigned home; no invented live readings."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from django.test import TestCase, SimpleTestCase

from . import home_conditions as service
from .models import Field

NOW = datetime(2026, 11, 15, 5, 30, tzinfo=timezone.utc)


def weather():
    return {'current_units': {'temperature_2m': '°C', 'relative_humidity_2m': '%', 'wind_speed_10m': 'km/h'},
            'current': {'time': '2026-11-15T05:15', 'temperature_2m': 28, 'relative_humidity_2m': 60,
                        'wind_speed_10m': 10, 'weather_code': 3},
            'daily_units': {'precipitation_sum': 'mm'}, 'daily': {
                'time': [(NOW.date() - timedelta(days=offset)).isoformat() for offset in range(7, -1, -1)],
                'precipitation_sum': [0, 0.2, 1, 2, 0, 3, 0, 99]}}


def air():
    return {'current_units': {'pm2_5': 'μg/m³', 'us_aqi': 'USAQI'},
            'current': {'time': '2026-11-15T05:00', 'pm2_5': 15, 'us_aqi': 65}}


@patch('website.home_conditions.timezone.now', return_value=NOW)
class HomeConditionsSourceTests(SimpleTestCase):
    def test_weather_units_and_complete_previous_week_exclude_today(self, now):
        result, rain = service.weather_summary(weather())
        self.assertEqual(result['temperature_c'], 28)
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(rain['dry_days'], 4)
        self.assertEqual(rain['rainfall_mm'], 6.2)
        self.assertEqual(rain['period_end'], '2026-11-14')
        missing_temperature = weather()
        missing_temperature['current']['temperature_2m'] = None
        self.assertEqual(service.weather_summary(missing_temperature)[0]['status'], 'unavailable')
        payload = weather()
        payload['daily']['precipitation_sum'][1] = None
        self.assertEqual(service.weather_summary(payload)[1]['status'], 'unavailable')
        payload['current_units']['wind_speed_10m'] = 'm/s'
        with self.assertRaises(ValueError):
            service.weather_summary(payload)

    def test_air_categories_missing_values_and_old_timestamp(self, now):
        payload = air()
        self.assertEqual(service.air_summary(payload)['level'], 'Moderate')
        payload['current']['pm2_5'] = None
        self.assertIsNone(service.air_summary(payload)['pm25'])
        payload['current']['us_aqi'] = -1
        self.assertIsNone(service.air_summary(payload)['level'])
        payload['current']['time'] = '2026-11-10T00:00'
        self.assertEqual(service.air_summary(payload)['status'], 'stale')

    @patch.object(service.cache, 'set')
    @patch.object(service.cache, 'get', return_value=None)
    @patch.object(service, 'read_source')
    def test_each_saved_location_is_sent_to_both_sources(self, read, cached, save, now):
        read.side_effect = lambda url, params: weather() if url == service.WEATHER else air()
        keys = set()
        for lat, lon in [(13.15081,108.43705), (17.9757,102.6331), (21.0285,105.8542)]:
            field = Field(latitude=lat, longitude=lon)
            result = service.get_conditions(field)
            self.assertEqual(result['status'], 'ok')
            self.assertEqual(result['latitude'], lat)
            for call in read.call_args_list[-2:]:
                self.assertEqual(call.args[1]['latitude'], lat)
                self.assertEqual(call.args[1]['longitude'], lon)
            keys.add(result['pin'])
        self.assertEqual(len(keys), 3)

    @patch.object(service.cache, 'set')
    @patch.object(service.cache, 'get', return_value=None)
    @patch.object(service, 'read_source')
    def test_independent_failure_keeps_real_air_and_missing_weather(self, read, cached, save, now):
        def source(url, params):
            if url == service.WEATHER:
                raise TimeoutError
            return air()
        read.side_effect = source
        result = service.get_conditions(Field(latitude=13.15081, longitude=108.43705))
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['weather']['status'], 'unavailable')
        self.assertEqual(result['air']['pm25'], 15)
        self.assertEqual(result['rain']['status'], 'unavailable')

    @patch.object(service.cache, 'set')
    @patch.object(service.cache, 'add', return_value=True)
    @patch.object(service.cache, 'get', return_value={'status': 'partial'})
    @patch.object(service, 'read_source')
    def test_explicit_retry_can_recover_a_failed_feed_but_has_a_cooldown(self, read, cached, cooldown, save, now):
        field = Field(latitude=22.3652593, longitude=94.9700784)
        self.assertEqual(service.get_conditions(field)['status'], 'partial')
        read.assert_not_called()
        read.side_effect = lambda url, params: weather() if url == service.WEATHER else air()
        self.assertEqual(service.get_conditions(field, refresh=True)['status'], 'ok')
        self.assertEqual(read.call_count, 2)
        self.assertEqual(cooldown.call_args.args[-1], 30)
        cooldown.return_value = False
        service.get_conditions(field, refresh=True)
        self.assertEqual(read.call_count, 2)
        cached.return_value = {'status': 'ok'}
        self.assertEqual(service.get_conditions(field, refresh=True)['status'], 'ok')
        self.assertEqual(read.call_count, 2)


class HomeLayoutTests(TestCase):
    def test_header_keeps_language_and_guest_account_adjacent_and_rotation_in_crops(self):
        page = self.client.get('/map/')
        self.assertContains(page, 'home-topbar')
        self.assertContains(page, 'id="home-risk-heading"')
        self.assertContains(page, 'id="alerts-dialog"')
        self.assertContains(page, '&micro;g/m&sup3;')
        content = page.content.decode()
        crop_start = content.index('id="results-panel-crops"')
        rotation = content.index('id="crop-plan"')
        weather_start = content.index('id="results-panel-weather"')
        self.assertTrue(crop_start < rotation < weather_start)

    @patch('website.views.get_conditions')
    def test_endpoint_ignores_query_coordinates_and_rejects_changed_pin(self, get):
        field = Field.objects.first()
        field.latitude, field.longitude = 13.15081, 108.43705
        field.save()
        from .crop_environment import pin_id
        get.return_value = {'status':'ok','pin':pin_id(field)}
        self.assertEqual(self.client.get('/api/home/conditions/?latitude=0').status_code, 200)
        self.assertEqual(float(get.call_args.args[0].latitude), 13.15081)
        def moved(saved):
            Field.objects.filter(pk=saved.pk).update(latitude=21.0285,longitude=105.8542)
            return {'status':'ok','pin':pin_id(saved)}
        get.side_effect = moved
        self.assertEqual(self.client.get('/api/home/conditions/').status_code,409)
