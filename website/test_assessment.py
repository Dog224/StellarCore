from datetime import timedelta
from unittest.mock import patch
from django.test import TestCase
from django.utils import timezone
from .assessment import assess_crop
from .models import Field
from .nasa_power import summarize_imerg


class AssessmentTests(TestCase):
    def setUp(self):
        self.weather = {'status': 'ok', 'period_end': (timezone.localdate() - timedelta(days=2)).isoformat(),
                        'temperature_c': 25, 'soil_moisture': {'status': 'ok', 'kind': 'wetness_index', 'surface': .7}}

    def test_pin_alone_does_not_diagnose_healthy_soil(self):
        result = assess_crop(self.weather, 'Mung Bean')
        self.assertEqual(result['status'], 'needs_checks')
        self.assertEqual(result['soil_health'], 'Not determined')

    def test_known_factors_can_be_potential_match_but_not_health_diagnosis(self):
        result = assess_crop(self.weather, 'Maize', ph=6, drainage='well')
        self.assertEqual(result['status'], 'possible')
        self.assertEqual(result['soil_health'], 'Not determined')
        self.assertIn('preliminary screen', result['limitations'])

    def test_poor_drainage_flags_mung_bean(self):
        self.assertEqual(assess_crop(self.weather, 'Mung Bean', ph=6.5, drainage='poor')['status'], 'review')

    def test_ph_and_temperature_constraints(self):
        self.assertEqual(assess_crop(self.weather, 'Maize', ph=9, drainage='well')['status'], 'review')
        self.weather['temperature_c'] = 8
        self.assertEqual(assess_crop(self.weather, 'Maize', ph=6, drainage='well')['status'], 'review')

    def test_rice_uses_water_management_instead_of_poor_drainage_rule(self):
        self.assertEqual(assess_crop(self.weather, 'Rice', ph=6, drainage='poor', water='yes')['status'], 'possible')
        self.assertEqual(assess_crop(self.weather, 'Rice', ph=6, drainage='poor')['status'], 'needs_checks')

    def test_unsupported_missing_and_stale_never_recommend_planting(self):
        self.assertEqual(assess_crop(self.weather, 'Unknown crop')['status'], 'unsupported')
        self.assertEqual(assess_crop({'status': 'unavailable'}, 'Rice')['status'], 'unavailable')
        self.weather['period_end'] = (timezone.localdate() - timedelta(days=30)).isoformat()
        self.assertEqual(assess_crop(self.weather, 'Rice', ph=6, water='yes')['status'], 'stale')

    @patch('website.views.get_field_weather')
    def test_assessment_inputs_are_validated_and_do_not_mutate_field(self, service):
        service.return_value = self.weather
        field = Field.objects.first()
        response = self.client.get('/api/weather/?crop=Maize&ph=6&drainage=well')
        self.assertEqual(response.json()['assessment']['status'], 'possible')
        field.refresh_from_db()
        self.assertEqual(field.next_crop, 'Mung Bean')
        self.assertEqual(self.client.get('/api/weather/?ph=15').status_code, 400)
        self.assertEqual(self.client.get('/api/weather/?drainage=madeup').status_code, 400)


class ImergTests(TestCase):
    def payload(self, end, value=1):
        return {'header': {'fill_value': -999}, 'parameters': {'IMERG_PRECTOT': {'units': 'mm/day'}},
                'properties': {'parameter': {'IMERG_PRECTOT': {(end - timedelta(days=i)).strftime('%Y%m%d'): value for i in range(7)}}}}

    def test_complete_week_total_and_zero_rain(self):
        end = timezone.localdate() - timedelta(days=2)
        for value in (1, 0):
            result = summarize_imerg(self.payload(end, value), end - timedelta(days=20), end)
            self.assertEqual(result['status'], 'ok')
            self.assertEqual(result['rainfall_mm'], value * 7)

    def test_old_archive_is_explicitly_stale(self):
        end = timezone.localdate() - timedelta(days=2)
        archive = end - timedelta(days=60)
        result = summarize_imerg(self.payload(archive), end - timedelta(days=99), end)
        self.assertEqual(result['status'], 'stale')
        self.assertEqual(result['period_end'], archive.isoformat())

    def test_missing_or_invalid_day_does_not_become_zero(self):
        end = timezone.localdate() - timedelta(days=2)
        for value in (-999, -1, None, float('nan'), True):
            payload = self.payload(end)
            payload['properties']['parameter']['IMERG_PRECTOT'][end.strftime('%Y%m%d')] = value
            result = summarize_imerg(payload, end - timedelta(days=20), end)
            self.assertEqual(result['status'], 'unavailable')
