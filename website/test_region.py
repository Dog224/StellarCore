from copy import deepcopy
from django.test import SimpleTestCase, TestCase
from .models import Field
from .region import contains_location, map_region, REGION_MESSAGE


COUNTRY_POINTS = [(18.0, 102.6), (13.7563, 100.5018), (16.8409, 96.1735),
                  (11.5564, 104.9282), (21.0285, 105.8542)]
OUTSIDE_POINTS = [(25.0389, 102.7183), (5.4141, 100.3288), (15, 93), (15, 109.5),
                  (23.81, 90.41), (1.35, 103.8), (0, 0), (float('nan'), 100)]


class RegionGeometryTests(SimpleTestCase):
    def test_all_five_countries_and_no_other_country(self):
        self.assertEqual({f['properties']['code'] for f in map_region()['features']}, {'LAO', 'THA', 'MMR', 'KHM', 'VNM'})
        for point in COUNTRY_POINTS:
            with self.subTest(point=point):
                self.assertTrue(contains_location(*point))
        for point in OUTSIDE_POINTS:
            with self.subTest(point=point):
                self.assertFalse(contains_location(*point))

    def test_holes_multipolygons_and_border_points(self):
        region = {'features': [{'bbox': [0, 0, 10, 10], 'geometry': {'type': 'MultiPolygon', 'coordinates': [
            [[[0, 0], [6, 0], [6, 6], [0, 6], [0, 0]], [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]],
            [[[8, 8], [10, 8], [10, 10], [8, 10], [8, 8]]],
        ]}}]}
        for latitude, longitude, expected in [(1, 1, True), (3, 3, False), (3, 2, True),
                                               (9, 9, True), (7, 7, False), (6, 6, True), (0, 0, True)]:
            self.assertEqual(contains_location(latitude, longitude, region), expected)
        polygon = deepcopy(region)
        polygon['features'][0]['geometry'] = {'type': 'Polygon', 'coordinates': region['features'][0]['geometry']['coordinates'][0]}
        self.assertTrue(contains_location(1, 1, polygon))
        self.assertFalse(contains_location(9, 9, polygon))

    def test_real_border_vertex_and_invalid_input(self):
        geometry = map_region()['features'][0]['geometry']
        polygon = geometry['coordinates'][0] if geometry['type'] == 'MultiPolygon' else geometry['coordinates']
        lon, lat = polygon[0][0]
        self.assertTrue(contains_location(lat, lon))
        self.assertFalse(contains_location(None, None))
        self.assertFalse(contains_location('bad', 100))
        self.assertFalse(contains_location(18, float('inf')))


class RegionSaveTests(TestCase):
    def test_each_supported_country_can_be_saved(self):
        for latitude, longitude in COUNTRY_POINTS:
            with self.subTest(point=(latitude, longitude)):
                response = self.client.post('/', {'action': 'location', 'latitude': latitude, 'longitude': longitude})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {'latitude': latitude, 'longitude': longitude})

    def test_rejected_location_leaves_saved_pin_unchanged(self):
        self.client.post('/', {'action': 'location', 'latitude': 18, 'longitude': 102.6})
        for latitude, longitude in OUTSIDE_POINTS:
            with self.subTest(point=(latitude, longitude)):
                response = self.client.post('/', {'action': 'location', 'latitude': latitude, 'longitude': longitude})
                self.assertEqual(response.status_code, 400)
                field = Field.objects.first()
                self.assertEqual((float(field.latitude), float(field.longitude)), (18, 102.6))
        response = self.client.post('/', {'action': 'location', 'latitude': 15, 'longitude': 93})
        self.assertIn(REGION_MESSAGE, response.json()['errors']['__all__'])

    def test_old_outside_pin_is_preserved_but_not_offered_as_valid_map_pin(self):
        field = Field.objects.first()
        field.latitude, field.longitude = 25.0389, 102.7183
        field.save()
        response = self.client.get('/map/')
        self.assertIsNone(response.context['map_config']['latitude'])
        self.assertTrue(response.context['map_config']['outside_region'])
        self.assertContains(response, 'map-region')
        field.refresh_from_db()
        self.assertAlmostEqual(float(field.latitude), 25.0389)
