from django.test import TestCase
from django.urls import reverse
from .models import Field, FarmEvent
from datetime import date, timedelta
from django.test import Client


class WebsiteTests(TestCase):
    def test_home(self):
        response = self.client.get(reverse('home'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Hello, Farmer!')
        self.assertContains(response, 'Crop Rotation Plan')

    def test_field_plan_is_saved_and_harvest_calculated(self):
        response = self.client.post(reverse('home'), {
            'action': 'field', 'name': 'North Plot', 'area': '8.50',
            'previous_crop': 'Rice', 'next_crop': 'Soybean', 'following_crop': 'Maize',
            'planting_date': '2026-12-01', 'maturity_days': '90',
        })
        self.assertRedirects(response, '/map/')
        field = Field.objects.first()
        self.assertEqual(field.name, 'North Plot')
        response = self.client.get('/map/')
        self.assertEqual(response.context['harvest'], date(2026, 12, 1) + timedelta(days=90))
        self.assertContains(response, 'Soybean')

    def test_invalid_field_is_rejected(self):
        response = self.client.post(reverse('home'), {'action': 'field', 'name': '', 'area': '-1'})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context['field_form'].errors)
        self.assertEqual(response.context['active_dialog'], 'field-dialog')

    def test_event_persists_and_can_be_completed(self):
        self.client.post('/', {'action': 'event', 'title': 'Prepare the land', 'date': '2026-11-20'})
        event = FarmEvent.objects.get()
        response = self.client.get('/map/?year=2026&month=11')
        self.assertContains(response, 'Prepare the land')
        self.assertTrue(any(cell['event'] for week in response.context['weeks'] for cell in week))
        self.client.post('/', {'action': 'complete', 'event_id': event.pk})
        event.refresh_from_db()
        self.assertTrue(event.completed)

    def test_invalid_event_does_not_save(self):
        response = self.client.post('/', {'action': 'event', 'title': '', 'date': 'bad-date'})
        self.assertTrue(response.context['event_form'].errors)
        self.assertFalse(FarmEvent.objects.exists())

    def test_invalid_calendar_parameters_fall_back(self):
        for query in ['?year=bad&month=99', '?year=9999&month=12', '?year=1&month=1']:
            self.assertEqual(self.client.get('/map/' + query).status_code, 200)

    def test_dashboard_json_matches_database(self):
        field = Field.objects.first()
        data = self.client.get('/api/dashboard/').json()
        self.assertEqual(data['field']['name'], field.name)
        self.assertEqual(data['environment']['source'], 'NASA POWER')

    def test_location_saves_and_is_in_map_config(self):
        response = self.client.post('/', {'action': 'location', 'latitude': '13.7563000', 'longitude': '100.5018000'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'latitude': 13.7563, 'longitude': 100.5018})
        field = Field.objects.first()
        self.assertEqual(float(field.latitude), 13.7563)
        self.assertEqual(self.client.get('/map/').context['map_config']['longitude'], 100.5018)
        self.assertEqual(self.client.get('/api/dashboard/').json()['field']['latitude'], 13.7563)

    def test_invalid_coordinates_do_not_save(self):
        for latitude, longitude in [('91', '100'), ('13', '-181'), ('NaN', '100'), ('', '100'), ('13', 'Infinity')]:
            response = self.client.post('/', {'action': 'location', 'latitude': latitude, 'longitude': longitude})
            self.assertEqual(response.status_code, 400)
        self.assertIsNone(Field.objects.first().latitude)

    def test_location_rejects_zero_outside_supported_countries(self):
        response = self.client.post('/', {'action': 'location', 'latitude': '0', 'longitude': '0'})
        self.assertEqual(response.status_code, 400)
        self.assertIsNone(Field.objects.first().latitude)

    def test_location_requires_csrf(self):
        response = Client(enforce_csrf_checks=True).post('/', {'action': 'location', 'latitude': '13', 'longitude': '100'})
        self.assertEqual(response.status_code, 403)

    def test_forms_require_csrf(self):
        self.assertEqual(Client(enforce_csrf_checks=True).post('/', {'action': 'event'}).status_code, 403)

    def test_admin_requires_login(self):
        self.assertEqual(self.client.get('/admin/').status_code, 302)
