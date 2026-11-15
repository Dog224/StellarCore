import io
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError
from django.core.cache.backends.locmem import LocMemCache
from django.test import SimpleTestCase, TestCase, override_settings
from . import copernicus as cdse


def interval(day, value=.6, missing=0, count=400):
    return {'interval': {'from': day + 'T00:00:00Z'},
            'outputs': {'ndvi': {'bands': {'B0': {'stats': {'mean': value, 'sampleCount': count, 'noDataCount': missing}}}}}}


class VegetationInterpretationTests(SimpleTestCase):
    today = date(2026, 11, 14)

    def test_cloudy_water_missing_and_invalid_values_are_not_measurements(self):
        payload = {'data': [interval('2026-11-12', missing=81), interval('2026-11-13', count=0),
                            interval('2026-11-14', float('nan')), interval('2026-11-15', .7),
                            interval('2026-11-11', .8, missing=400), interval('2026-11-10', 2)]}
        result = cdse.summarize_statistics(payload, self.today)
        self.assertEqual(result['status'], 'no_clear_observation')
        self.assertIsNone(result['latest'])

    def test_zero_ndvi_is_valid_and_80_percent_coverage_is_inclusive(self):
        result = cdse.summarize_statistics({'data': [interval('2026-11-12', 0, missing=80)]}, self.today)
        self.assertEqual(result['latest']['ndvi'], 0)
        self.assertEqual(result['latest']['usable_percent'], 80)
        self.assertEqual(result['trend'], 'insufficient')

    def test_decline_and_growth_use_distinct_observation_days(self):
        data = {'data': [interval('2026-11-12', .4), interval('2026-11-10', .6), interval('2026-11-12', .4)]}
        result = cdse.summarize_statistics(data, self.today)
        self.assertEqual(len(result['observations']), 2)
        self.assertEqual(result['delta'], -.2)
        self.assertEqual(result['trend'], 'decreased')
        self.assertEqual(cdse.summarize_statistics({'data': [interval('2026-11-10', .4), interval('2026-11-12', .6)]}, self.today)['trend'], 'increased')

    def test_stale_and_distant_dates_do_not_claim_a_current_trend(self):
        result = cdse.summarize_statistics({'data': [interval('2026-09-10'), interval('2026-10-10', .2)]}, self.today)
        self.assertEqual(result['status'], 'stale')
        self.assertEqual(result['trend'], 'stale')
        self.assertIsNone(result['delta'])
        result = cdse.summarize_statistics({'data': [interval('2026-10-01'), interval('2026-11-10', .2)]}, self.today)
        self.assertEqual(result['trend'], 'insufficient')


@override_settings(COPERNICUS_CLIENT_ID='', COPERNICUS_CLIENT_SECRET='')
class CopernicusSourceTests(SimpleTestCase):
    def setUp(self):
        self.field = SimpleNamespace(latitude=18.01, longitude=102.65)
        local = LocMemCache('copernicus-tests', {})
        local.clear()
        cached = patch('website.copernicus.cache', local)
        cached.start(); self.addCleanup(cached.stop)
        cdse._tokens.clear()

    def test_location_and_credentials_are_required_without_fake_ndvi(self):
        with patch('website.copernicus._request') as request:
            self.assertEqual(cdse.vegetation_at_pin(None)['status'], 'needs_location')
            self.assertEqual(cdse.vegetation_at_pin(self.field)['status'], 'not_configured')
            request.assert_not_called()
        self.assertEqual(cdse.footprint(self.field)['sample_width_m'], 200)
        with self.assertRaises(cdse.CopernicusError):
            cdse.footprint(SimpleNamespace(latitude=89, longitude=102))

    @patch('website.copernicus._request')
    def test_public_catalogue_needs_no_token_and_reports_tile_clouds_honestly(self, request):
        request.return_value = {'features': [{'id': 'test-scene', 'properties': {'datetime': '2026-11-11T03:00:00Z', 'eo:cloud_cover': 73.87}}]}
        result = cdse.catalogue_at_pin(self.field)
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['observations'][0]['tile_cloud_percent'], 73.9)
        self.assertIn('not the cloud cover over your field', result['cloud_note'])
        self.assertNotIn('ndvi', result)
        self.assertEqual(len(request.call_args.args), 1)
        cdse.catalogue_at_pin(self.field)
        self.assertEqual(request.call_count, 1)
        self.field.latitude = 19.01
        cdse.catalogue_at_pin(self.field)
        self.assertEqual(request.call_count, 2)

    @override_settings(COPERNICUS_CLIENT_ID='test-client', COPERNICUS_CLIENT_SECRET='never-expose-this')
    @patch('website.copernicus._request')
    def test_processing_contract_token_reuse_and_no_credentials_in_result(self, request):
        today = cdse.timezone.now().date().isoformat()
        request.side_effect = [{'access_token': 'private-token', 'expires_in': 300}, {'data': [interval(today)]}]
        result = cdse.vegetation_at_pin(self.field)
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['latest']['ndvi'], .6)
        stats_request = request.call_args.args
        self.assertEqual(stats_request[0], cdse.STATISTICS)
        self.assertIn('s.SCL === 4 || s.SCL === 5', stats_request[1]['aggregation']['evalscript'])
        self.assertEqual(stats_request[2], 'private-token')
        self.assertEqual(cdse.access_token(), 'private-token')
        self.assertEqual(request.call_count, 2)
        self.assertNotIn('never-expose-this', str(result))
        self.assertNotIn('private-token', str(result))
        cdse.vegetation_at_pin(self.field)
        self.assertEqual(request.call_count, 2)

    @override_settings(COPERNICUS_CLIENT_ID='test', COPERNICUS_CLIENT_SECRET='secret')
    @patch('website.copernicus._request', side_effect=cdse.CopernicusError('rate_limited'))
    def test_provider_failures_remain_unknown_and_are_cached_briefly(self, request):
        result = cdse.vegetation_at_pin(self.field)
        self.assertEqual(result['status'], 'rate_limited')
        self.assertNotIn('latest', result)
        cdse.vegetation_at_pin(self.field)
        self.assertEqual(request.call_count, 1)

    def test_image_requires_current_pin_and_verified_observation_date(self):
        pin = cdse.footprint(self.field)['pin']
        with patch('website.copernicus.vegetation_at_pin', return_value={'status': 'ok', 'observations': [{'date': '2026-11-10'}]}):
            with self.assertRaisesRegex(cdse.CopernicusError, 'pin_changed'): cdse.vegetation_image(self.field, 'old-pin', '2026-11-10')
            with self.assertRaisesRegex(cdse.CopernicusError, 'invalid_observation'): cdse.vegetation_image(self.field, pin, 'https://fake.example')
        self.field.latitude = 18.02
        self.assertNotEqual(cdse.footprint(self.field)['pin'], pin)

    @patch('website.copernicus.access_token', return_value='token')
    @patch('website.copernicus._request')
    def test_image_uses_the_same_mask_date_and_footprint(self, request, token):
        footprint = cdse.footprint(self.field)
        request.return_value = b'png-test'
        with patch('website.copernicus.vegetation_at_pin', return_value={'status': 'ok', 'observations': [{'date': '2026-11-10'}]}):
            self.assertEqual(cdse.vegetation_image(self.field, footprint['pin'], '2026-11-10'), b'png-test')
        payload = request.call_args.args[1]
        self.assertEqual(payload['input']['bounds']['bbox'], footprint['bbox'])
        self.assertEqual(payload['input']['data'][0]['dataFilter']['timeRange']['to'], '2026-11-11T00:00:00Z')
        self.assertIn(cdse.MASK, payload['evalscript'])
        self.assertEqual(payload['output']['width'], 20)

    @patch('website.copernicus.urlopen')
    def test_http_errors_and_non_png_responses_do_not_leak_or_become_images(self, fetch):
        fetch.side_effect = HTTPError(cdse.STATISTICS, 401, 'sensitive response', {}, io.BytesIO(b'private-token'))
        with self.assertRaisesRegex(cdse.CopernicusError, '^access_required$'): cdse._request(cdse.STATISTICS, {}, 'private-token')
        fetch.side_effect = None
        fetch.return_value.__enter__.return_value.read.return_value = b'<html>not imagery</html>'
        with self.assertRaises(cdse.CopernicusError): cdse._request(cdse.PROCESS, {}, 'token', binary=True)


class CopernicusApiTests(TestCase):
    def test_api_is_read_only_and_uses_saved_location(self):
        self.assertEqual(self.client.get('/api/copernicus/?kind=catalogue&latitude=18&longitude=102').json()['status'], 'needs_location')
        self.assertEqual(self.client.get('/api/copernicus/?kind=unknown').status_code, 400)
        self.assertEqual(self.client.post('/api/copernicus/').status_code, 405)
        response = self.client.get('/api/copernicus/image/?pin=fake&date=2026-11-10')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response['Cache-Control'], 'no-store')
