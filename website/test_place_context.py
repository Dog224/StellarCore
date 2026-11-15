"""Provider-contract fixtures, not live place/photo claims."""
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase, SimpleTestCase

from . import place_context as places
from .crop_environment import pin_id
from .models import Field


def photo(lat=21.0285, lon=105.8542, **changes):
    result = {'title': 'File:Nearby lake.jpg', 'coordinates': [{'lat': lat, 'lon': lon, 'primary': '', 'globe': 'earth'}],
              'imageinfo': [{'mime': 'image/jpeg', 'thumburl': 'https://thumb.wikimedia.org/example.jpg',
                            'descriptionurl': 'https://commons.wikimedia.org/wiki/File:Nearby_lake.jpg',
                            'extmetadata': {'Artist': {'value': '<a href="https://example.com">Photographer</a>'},
                                            'LicenseShortName': {'value': 'CC BY-SA 4.0'},
                                            'LicenseUrl': {'value': 'https://creativecommons.org/licenses/by-sa/4.0/'}}}]}
    result.update(changes)
    return result


class PlaceSourceTests(SimpleTestCase):
    def setUp(self):
        self.values = {}
        self.cache = patch.object(places, 'cache', SimpleNamespace(get=lambda key, default=None: self.values.get(key, default),
            set=lambda key, value, timeout: self.values.__setitem__(key, value)))
        self.cache.start()
        self.addCleanup(self.cache.stop)

    @patch.object(places, '_json')
    def test_photo_uses_geotagged_commons_media_and_preserves_credits(self, read):
        read.return_value = {'query': {'pages': {'1': photo()}}}
        result = places._nearby_photo(21.0285, 105.8542, {'code': 'VNM'})
        self.assertEqual(result['author'], 'Photographer')
        self.assertEqual(result['distance_km'], 0)
        self.assertEqual(result['license'], 'CC BY-SA 4.0')
        self.assertEqual(read.call_args.args[1]['ggsnamespace'], 6)
        self.assertEqual(read.call_args.args[1]['ggsradius'], 10000)

    @patch.object(places, '_json')
    def test_far_away_wrong_country_unlicensed_and_non_photo_results_are_excluded(self, read):
        cases = [photo(lat=18.92, lon=102.45), photo(title='File:City map.jpg')]
        invalid_license = photo()
        invalid_license['imageinfo'][0]['extmetadata']['LicenseUrl']['value'] = 'javascript:alert(1)'
        cases.append(invalid_license)
        invalid_host = photo()
        invalid_host['imageinfo'][0]['thumburl'] = 'https://example.com/unverified.jpg'
        cases.append(invalid_host)
        for item in cases:
            read.return_value = {'query': {'pages': {'1': item}}}
            self.assertIsNone(places._nearby_photo(21.0285, 105.8542, {'code': 'VNM'}))
        read.return_value = {'query': {'pages': {'1': photo()}}}
        # A geotag in Vietnam must never illustrate a pin attributed to Laos.
        self.assertIsNone(places._nearby_photo(21.0285, 105.8542, {'code': 'LAO'}))

    @patch.object(places, '_json')
    def test_address_uses_locality_hierarchy_checks_country_and_throttles(self, read):
        read.return_value = {'address': {'county': 'Ea Hiao', 'state': 'Dak Lak', 'country_code': 'vn'}}
        result = places._address(13.15081, 108.43705, {'code': 'VNM', 'name': 'Vietnam'})
        self.assertEqual(result['label'], 'Ea Hiao, Dak Lak, Vietnam')
        self.assertIsNone(places._address(21.0285, 105.8542, {'code': 'VNM', 'name': 'Vietnam'}))
        self.assertEqual(read.call_count, 1)
        self.values.clear()
        self.assertIsNone(places._address(13.15081, 108.43705, {'code': 'LAO', 'name': 'Laos'}))

    @patch.object(places, '_nearby_photo', return_value=None)
    @patch.object(places, '_address')
    def test_three_locations_have_separate_context_and_cache_keys(self, address, nearby):
        labels = []
        for name, lat, lon in [('Dak Lak', 13.15081, 108.43705), ('Hanoi', 21.0285, 105.8542), ('Vientiane', 17.9757, 102.6331)]:
            address.return_value = {'label': name}
            result = places.get_place(lat, lon)
            labels.append(result['label'])
            self.assertEqual(result['latitude'], lat)
            self.assertIsNone(result['photo'])
            self.assertEqual(places.get_place(lat, lon), result)
        self.assertEqual(len(set(labels)), 3)
        self.assertEqual(address.call_count, 3)
        self.assertEqual(nearby.call_count, 3)

    @patch.object(places, '_nearby_photo', side_effect=TimeoutError)
    @patch.object(places, '_address', side_effect=TimeoutError)
    def test_outage_is_an_honest_country_coordinates_fallback(self, address, nearby):
        result = places.get_place(13.15081, 108.43705)
        self.assertEqual(result['status'], 'unavailable')
        self.assertEqual(result['label'], 'Vietnam')
        self.assertIsNone(result['photo'])
        self.assertNotIn('Vang Vieng', str(result))
        self.assertEqual(places.get_place(0, 0)['status'], 'outside_region')
        self.assertEqual(address.call_count, 1)


class PlaceEndpointTests(TestCase):
    def setUp(self):
        self.field = Field.objects.first()
        self.field.latitude, self.field.longitude = 13.15081, 108.43705
        self.field.save()

    @patch('website.views.get_place', return_value={'status': 'ok', 'label': 'Vietnam', 'photo': None})
    def test_endpoint_only_reads_saved_pin_and_does_not_cache_private_response(self, service):
        response = self.client.get('/api/place/?latitude=18&longitude=102')
        service.assert_called_once_with(13.15081, 108.43705)
        self.assertEqual(response.json()['pin'], pin_id(self.field))
        self.assertEqual(response['Cache-Control'], 'no-store')

    @patch('website.views.get_place')
    def test_unsaved_and_changed_pins_do_not_receive_old_place_context(self, service):
        def changed(*args):
            Field.objects.filter(pk=self.field.pk).update(latitude=21.0285, longitude=105.8542)
            return {'status': 'ok', 'label': 'Old area'}
        service.side_effect = changed
        self.assertEqual(self.client.get('/api/place/').status_code, 409)
        Field.objects.filter(pk=self.field.pk).update(latitude=None, longitude=None)
        service.reset_mock()
        self.assertEqual(self.client.get('/api/place/').json()['status'], 'needs_location')
        service.assert_not_called()
