import io
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
import tifffile
from django.core.cache.backends.locmem import LocMemCache
from django.test import SimpleTestCase, TestCase
from .gaez import catalogue, get_point, initial_selection, DEFAULTS
from .gaez_raster import sample_cell, decode_lzw, RangeFile


class GaezTests(TestCase):
    def setUp(self):
        self.field = SimpleNamespace(latitude=17.97, longitude=102.60, next_crop='Mung Bean')
        self.cache = LocMemCache('gaez-tests', {})
        self.cache.clear()
        self.patch = patch('website.gaez.cache', self.cache)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_all_six_themes_have_documented_layers(self):
        themes = {layer['theme'] for layer in catalogue()['layers']}
        self.assertEqual(themes, set(range(1, 7)))
        for layer in catalogue()['layers']:
            self.assertTrue(layer['source_url'].startswith('https://data.fao.org/'))
            self.assertIsInstance(layer['scale'], (float, int))

    def test_unsupported_crop_is_not_silently_replaced(self):
        result = get_point(self.field, DEFAULTS[4], {})
        self.assertEqual(result['status'], 'selection_required')
        self.assertEqual(result['selections']['CROP-RES05'], '')

    def test_no_location_and_bad_selections(self):
        self.assertEqual(get_point(None, DEFAULTS[1], {})['status'], 'needs_location')
        with self.assertRaises(ValueError): get_point(self.field, 'http://evil.example', {})
        with self.assertRaises(ValueError): get_point(self.field, DEFAULTS[4], {'CROP-RES05': '../../bad'})
        with self.assertRaises(ValueError): get_point(self.field, DEFAULTS[4], {'unexpected': 'value'})

    @patch('website.gaez.sample_cell')
    def test_real_source_naming_and_cached_class_result(self, sample):
        sample.return_value = {'status': 'ok', 'raw_value': 8, 'offset': 0,
                               'resolution_degrees': [.0083333, .0083333], 'cell_center': [17.9708, 102.6041]}
        result = get_point(self.field, DEFAULTS[4], {'CROP-RES05': 'MZE'})
        self.assertEqual(result['value'], 8)
        self.assertIn('GAEZ-V5.RES05-SIX30AS.HP0120.AGERA5.HIST.MZE.LRLM.tif', result['raster_url'])
        self.assertEqual(result['selection_labels']['Crop'], 'Maize')
        get_point(self.field, DEFAULTS[4], {'CROP-RES05': 'MZE'})
        self.assertEqual(sample.call_count, 1)
        changed = SimpleNamespace(latitude=18, longitude=103, next_crop='Maize')
        get_point(changed, DEFAULTS[4], {'CROP-RES05': 'MZE'})
        self.assertEqual(sample.call_count, 2)

    @patch('website.gaez.sample_cell')
    def test_catalogue_nodata_is_not_unsuitable_or_zero_yield(self, sample):
        sample.return_value = {'status': 'ok', 'raw_value': 0, 'offset': 0}
        result = get_point(self.field, 'RES06-YLD', {'CROP-RES06': 'MZE'})
        self.assertEqual(result['status'], 'no_data')
        self.assertNotIn('value', result)

    @patch('website.gaez.sample_cell', side_effect=TimeoutError('slow source'))
    def test_source_timeout_isolated_to_requested_theme(self, sample):
        result = get_point(self.field, DEFAULTS[2], {})
        self.assertEqual(result['status'], 'unavailable')
        self.assertTrue(result['source_url'])

    def test_historical_future_mismatch_is_not_queried(self):
        result = get_point(self.field, DEFAULTS[2], {'SSP': 'SSP126'})
        self.assertEqual(result['status'], 'selection_required')

    def test_catalogue_and_point_routes(self):
        response = self.client.get('/api/gaez/catalog/')
        self.assertEqual(len(response.json()['themes']), 6)
        self.assertEqual(self.client.get('/api/gaez/point/?layer=unknown').status_code, 400)
        self.assertEqual(self.client.post('/api/gaez/catalog/').status_code, 405)


class RasterReaderTests(SimpleTestCase):
    def tiff(self, nodata='-9999'):
        result = io.BytesIO()
        array = np.array([[1, 2, 3], [4, -9999, 6]], dtype=np.int16)
        tifffile.imwrite(result, array, metadata=None, extratags=[
            (33550, 'd', 3, (1, 1, 0), False), (33922, 'd', 6, (0, 0, 0, 100, 20, 0), False),
            (34735, 'H', 12, (1, 1, 0, 2, 1024, 0, 1, 2, 2048, 0, 1, 4326), False),
            (42113, 's', len(nodata) + 1, nodata, False)])
        class Memory(io.BytesIO): downloaded = 0
        return Memory(result.getvalue())

    def test_coordinate_order_and_nearest_cell(self):
        with patch('website.gaez_raster.RangeFile', return_value=self.tiff()):
            result = sample_cell('source', 19.5, 101.5)
        self.assertEqual(result['value'], 2)
        self.assertEqual(result['cell_center'], [19.5, 101.5])

    def test_nodata_and_outside_coverage(self):
        with patch('website.gaez_raster.RangeFile', return_value=self.tiff()):
            self.assertEqual(sample_cell('source', 18.5, 101.5)['status'], 'no_data')
        with patch('website.gaez_raster.RangeFile', return_value=self.tiff()):
            self.assertEqual(sample_cell('source', 50, 100)['status'], 'outside_coverage')

    def test_lzw_dictionary_references(self):
        bits = ''.join(format(code, '09b') for code in [256, 65, 66, 258, 260, 257])
        bits += '0' * ((-len(bits)) % 8)
        encoded = int(bits, 2).to_bytes(len(bits) // 8, 'big')
        self.assertEqual(decode_lzw(encoded, 7), b'ABABABA')
        with self.assertRaises(ValueError): decode_lzw(encoded, 3)

    def test_lzw_early_width_boundaries(self):
        bits = format(256, '09b')
        expected = bytes(index % 256 for index in range(1200))
        for index, value in enumerate(expected):
            width = 9 if index < 254 else 10 if index < 766 else 11
            bits += format(value, f'0{width}b')
        bits += format(257, '011b')
        bits += '0' * ((-len(bits)) % 8)
        encoded = int(bits, 2).to_bytes(len(bits) // 8, 'big')
        self.assertEqual(decode_lzw(encoded, len(expected)), expected)

    def test_range_reads_are_cached_and_full_download_is_refused(self):
        local = LocMemCache('gaez-http-test', {})
        local.clear()
        class Response(io.BytesIO):
            def __init__(self, code):
                super().__init__(b'A' * 65536)
                self.status = code
                self.headers = {'Content-Length': '100000', 'Content-Range': 'bytes 0-65535/100000'}
        with patch('website.gaez_raster.cache', local), patch('website.gaez_raster.urlopen', side_effect=[Response(200), Response(206)]) as fetch:
            with RangeFile('https://source/file') as file:
                file.seek(5)
                self.assertEqual(file.read(5), b'AAAAA')
                file.seek(5)
                self.assertEqual(file.read(5), b'AAAAA')
                self.assertEqual(fetch.call_count, 2)
        local.clear()
        with patch('website.gaez_raster.cache', local), patch('website.gaez_raster.urlopen', side_effect=[Response(200), Response(200)]):
            with RangeFile('https://source/file') as file:
                with self.assertRaises(ValueError): file.read(5)
