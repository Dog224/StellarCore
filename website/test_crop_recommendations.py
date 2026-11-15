import json
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
from django.conf import settings
from django.core.cache.backends.locmem import LocMemCache
from django.test import TestCase, SimpleTestCase
from .models import CropProfile, Field
from .crop_recommendations import membership, score_profile, recommend, planting_window
from .crop_environment import pin_id, climate, get_environment


def environment(lat=18,lon=102.6,temp=26.1,rain=1762.7,elevation=173):
    field=SimpleNamespace(latitude=lat,longitude=lon)
    monthly=[{'month':i,'temperature_c':temp,'rainfall_mm':rain/12} for i in range(1,13)]
    source={'status':'ok','source':'Test source, not production data','dataset_period':'test period','source_url':'https://example.test/climate','months':monthly}
    return {'status':'ok','pin':pin_id(field),'latitude':lat,'longitude':lon,'temperature_c':temp,'annual_rainfall_mm':rain,
            'elevation_m':elevation,'ph':None,'texture':None,'climate':source,'seasonal_climate':source.copy(),
            'terrain':{'status':'ok','source_url':'https://example.test/terrain'},'soil':{'status':'unknown'}}


class RangeTests(SimpleTestCase):
    def test_optimal_taper_absolute_and_missing(self):
        req={'optimal':[22,32],'absolute':[10,45]}
        self.assertEqual(membership(27,req),(100,'within_optimal'))
        self.assertAlmostEqual(membership(16,req)[0],50)
        self.assertAlmostEqual(membership(38.5,req)[0],50)
        self.assertEqual(membership(46,req),(0,'outside_absolute'))
        self.assertEqual(membership(10,req)[0],0)
        self.assertIsNone(membership(None,req)[0])
        self.assertIsNone(membership(float('nan'),req)[0])

    def test_unreported_altitude_floor_is_not_invented(self):
        self.assertEqual(membership(-5,{'optimal':[None,None],'absolute':[None,2800]})[0],100)
        self.assertIsNone(membership(100,{'optimal':[None,None],'absolute':[None,None]})[0])


class CropDatabaseTests(TestCase):
    def test_required_species_and_distinct_vegetables_are_sourced(self):
        self.assertEqual(CropProfile.objects.count(),13)
        self.assertTrue(set(['rice','maize','cassava','arabica-coffee','robusta-coffee','banana','peanut','soybean','mung-bean','tomato','cabbage','cucumber','chilli'])<=set(CropProfile.objects.values_list('slug',flat=True)))
        for crop in CropProfile.objects.all():
            self.assertTrue(crop.source['url'].startswith('https://ecocrop.apps.fao.org/'))
            self.assertIsNone(crop.source['publication_date'])
            self.assertTrue(crop.source['retrieved_on'])
            self.assertEqual(set(crop.requirements),{'temperature_c','annual_rainfall_mm','elevation_m','ph','texture','drainage'})
            self.assertTrue((settings.BASE_DIR/'website/static'/crop.image_path).exists())

    def test_published_examples_and_missing_values_are_preserved(self):
        peanut=CropProfile.objects.get(slug='peanut')
        self.assertEqual(peanut.requirements['temperature_c'],{'optimal':[22,32],'absolute':[10,45],'unit':'°C'})
        self.assertEqual(peanut.requirements['ph']['optimal'],[5.5,6.5])
        self.assertEqual(peanut.water['seasonal_mm'],[500,700])
        self.assertEqual(peanut.water['planning_growing_days'],[130,140])
        self.assertIsNone(peanut.requirements['elevation_m']['absolute'][0])
        mung=CropProfile.objects.get(slug='mung-bean')
        self.assertIsNone(mung.water['seasonal_mm'])
        self.assertIsNone(mung.gaez_code)
        self.assertNotEqual(mung.growing_days,[75,75])

    def test_all_active_profiles_are_ranked_not_the_saved_rotation(self):
        field=Field.objects.first();field.next_crop='Imaginary crop'
        result=recommend(field,environment())
        self.assertEqual(len(result['crops']),13)
        self.assertNotIn('Imaginary crop',[c['name'] for c in result['crops']])
        self.assertEqual(result['crops'][0]['score'],max(c['score'] for c in result['crops']))

    def test_three_distinct_environments_change_actual_database_rankings(self):
        snapshots=[environment(),environment(15.18,106.23,20.05,3496.6,1285),environment(21.68,102.10,20.26,1925.8,1360)]
        reports=[recommend(Field.objects.first(),item) for item in snapshots]
        self.assertEqual(len({tuple(c['id'] for c in r['crops'][:3]) for r in reports}),3)
        self.assertEqual(len({r['environment']['pin'] for r in reports}),3)
        for report in reports:
            scores=[crop['score'] for crop in report['crops']]
            self.assertEqual(scores,sorted(scores,reverse=True))

    def test_equal_evidence_produces_equal_results_without_latitude_bonuses(self):
        first=environment();second=environment(lat=18.001)
        a,b=recommend(Field.objects.first(),first),recommend(Field.objects.first(),second)
        self.assertEqual([(c['id'],c['score']) for c in a['crops']],[(c['id'],c['score']) for c in b['crops']])

    def test_unknown_soil_is_not_a_match_or_a_fertility_measurement(self):
        result=score_profile(CropProfile.objects.get(slug='rice'),environment())
        self.assertEqual(result['assessed_factors'],3)
        self.assertEqual(result['missing_factors'],['ph','texture'])
        self.assertEqual(result['evidence'],'partial')
        self.assertTrue(all(check['score'] is None for check in result['checks'] if check['factor'] in ('ph','texture')))

    def test_absolute_rain_or_elevation_constraints_cannot_be_averaged_away(self):
        maize=score_profile(CropProfile.objects.get(slug='maize'),environment(rain=3496))
        robusta=score_profile(CropProfile.objects.get(slug='robusta-coffee'),environment(elevation=1360))
        self.assertEqual(maize['score'],0)
        self.assertIn('annual_rainfall_mm',maize['constraints'])
        self.assertEqual(robusta['score'],0)
        self.assertIn('elevation_m',robusta['constraints'])

    def test_bad_known_ph_and_texture_constrain_but_unknowns_do_not(self):
        env=environment();env.update(ph=12,texture='heavy')
        result=score_profile(CropProfile.objects.get(slug='arabica-coffee'),env)
        self.assertEqual(result['score'],0)
        self.assertIn('ph',result['constraints'])
        self.assertIn('texture',result['constraints'])

    def test_missing_core_climate_never_falls_back_to_fixed_crops(self):
        env=environment();env['status']='unavailable';env['climate']['status']='unavailable'
        result=recommend(Field.objects.first(),env)
        self.assertEqual(result['recommendations'],[])
        self.assertTrue(all(crop['score'] is None and crop['rank'] is None for crop in result['crops']))

    def test_perennial_fruit_cycle_is_not_first_harvest(self):
        result=score_profile(CropProfile.objects.get(slug='arabica-coffee'),environment())
        self.assertIsNone(result['first_harvest_days'])
        self.assertIsNone(result['season']['harvest_start'])
        self.assertEqual(result['season']['reason'],'perennial_establishment_unknown')

    def test_unknown_water_reference_does_not_invent_a_planting_season(self):
        result=score_profile(CropProfile.objects.get(slug='cassava'),environment(),date(2026,11,14))
        self.assertEqual(result['season']['reason'],'missing_seasonal_water_reference')
        self.assertEqual(result['season']['months'],[])

    def test_conditional_harvest_uses_sourced_days_and_future_planting(self):
        result=score_profile(CropProfile.objects.get(slug='peanut'),environment(rain=1400),date(2026,11,14))
        season=result['season']
        self.assertEqual(season['status'],'estimated')
        start=date.fromisoformat(season['next_start'])
        self.assertGreaterEqual(start,date(2026,11,14))
        self.assertEqual(date.fromisoformat(season['harvest_start'])-start,timedelta(days=130))
        self.assertEqual(date.fromisoformat(season['harvest_end'])-start,timedelta(days=140))
        self.assertIn('not a verified Lao planting calendar',season['basis'])

    def test_no_suitable_climate_still_shows_reasons_not_default_recommendations(self):
        result=recommend(Field.objects.first(),environment(temp=-30,rain=0))
        self.assertEqual(result['recommendations'],[])
        self.assertTrue(all(crop['score']==0 for crop in result['crops']))


class EnvironmentTests(SimpleTestCase):
    def setUp(self):
        local=LocMemCache('crop-environment-tests',{});local.clear()
        cached=patch('website.crop_environment.cache',local);cached.start();self.addCleanup(cached.stop)
        self.field=SimpleNamespace(latitude=18,longitude=102.6,next_crop='')

    def payload(self):
        series={name:{month:value for month in ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC','ANN']} for name,value in [('T2M',25),('PRECTOTCORR',2)]}
        return {'properties':{'parameter':series},'parameters':{'T2M':{'units':'C'},'PRECTOTCORR':{'units':'mm/day'}},'header':{'range':'test source period','fill_value':-999}}

    @patch('website.crop_environment.read_json')
    def test_monthly_daily_rain_rates_are_converted_and_cache_is_per_pin(self,read):
        read.return_value=self.payload()
        first=climate(self.field)
        self.assertAlmostEqual(first['annual_rainfall_mm'],730.5,places=1)
        self.assertEqual(first['dataset_period'],'test source period')
        climate(self.field);self.assertEqual(read.call_count,1)
        self.field.latitude=21.68;climate(self.field)
        self.assertEqual(read.call_count,2)
        self.assertIn('latitude=21.68',read.call_args.args[0])

    @patch('website.crop_environment.read_json')
    def test_fill_values_and_bad_units_are_not_zero_rain(self,read):
        raw=self.payload();raw['properties']['parameter']['PRECTOTCORR']['JAN']=-999
        read.return_value=raw
        self.assertEqual(climate(self.field)['status'],'unavailable')
        self.field.latitude=19;raw=self.payload();raw['parameters']['PRECTOTCORR']['units']='mm/month';read.return_value=raw
        self.assertEqual(climate(self.field)['status'],'unavailable')

    @patch('website.crop_environment.elevation',return_value={'status':'ok','elevation_m':1285})
    @patch('website.crop_environment.climate',return_value={'status':'ok','temperature_c':24.62,'annual_rainfall_mm':1292.6})
    @patch('website.crop_environment.get_point')
    def test_finer_fao_pair_is_preferred_without_inventing_soil_values(self,point,nasa,elev):
        def sample(field,layer,dimensions):return {'status':'ok','value':20.05 if layer=='RES01-TMP' else 3496.6,'unit':'deg C' if layer=='RES01-TMP' else 'mm','source_url':'https://data.fao.org/','retrieved_at':'date'}
        point.side_effect=sample
        result=get_environment(self.field)
        self.assertEqual(result['temperature_c'],20.05);self.assertEqual(result['annual_rainfall_mm'],3496.6)
        self.assertFalse(result['climate']['fallback'])
        self.assertIsNone(result['ph']);self.assertIsNone(result['texture'])

    @patch('website.crop_environment.elevation',return_value={'status':'unavailable','elevation_m':None})
    @patch('website.crop_environment.climate',return_value={'status':'ok','temperature_c':25,'annual_rainfall_mm':1200})
    @patch('website.crop_environment.get_point',return_value={'status':'unavailable'})
    def test_real_nasa_fallback_is_explicit_and_never_a_sample(self,point,nasa,elev):
        result=get_environment(self.field)
        self.assertTrue(result['climate']['fallback'])
        self.assertEqual(result['temperature_c'],25)
        self.assertIn('coarser',result['climate']['fallback_reason'])

    def test_no_location_performs_no_remote_reads(self):
        with patch('website.crop_environment.read_json') as read:
            self.assertEqual(get_environment(None)['status'],'needs_location');read.assert_not_called()


class CropApiTests(TestCase):
    @patch('website.crop_recommendations.get_environment')
    def test_moving_saved_pin_changes_inputs_environment_and_rankings(self,get_env):
        snapshots={18:(26.1,1762.7,173),15.18:(20.05,3496.6,1285),21.68:(20.26,1925.8,1360)}
        get_env.side_effect=lambda f:environment(float(f.latitude),float(f.longitude),*snapshots[float(f.latitude)])
        reports=[]
        for lat,lon in [(18,102.6),(15.18,106.23),(21.68,102.10)]:
            self.client.post('/',{'action':'location','latitude':lat,'longitude':lon})
            response=self.client.get('/api/crops/recommendations/')
            self.assertEqual(response.status_code,200);self.assertEqual(response['Cache-Control'],'no-store');reports.append(response.json())
        self.assertNotEqual(reports[0]['pin'],reports[1]['pin'])
        self.assertNotEqual(reports[0]['recommendations'],reports[1]['recommendations'])
        self.assertEqual(reports[1]['environment']['latitude'],15.18)
        self.assertEqual(len({tuple(r['recommendations']) for r in reports}),3)

    def test_unknown_saved_location_ignores_arbitrary_get_coordinates(self):
        response=self.client.get('/api/crops/recommendations/?latitude=18&longitude=102')
        self.assertEqual(response.json()['status'],'needs_location')
        self.assertEqual(self.client.post('/api/crops/recommendations/').status_code,405)

    @patch('website.crop_recommendations.get_environment')
    def test_old_response_is_rejected_if_database_pin_changes_during_reads(self,get_env):
        self.client.post('/',{'action':'location','latitude':18,'longitude':102.6})
        def move(field):
            result=environment();Field.objects.filter(pk=field.pk).update(latitude=15.18,longitude=106.23);return result
        get_env.side_effect=move
        self.assertEqual(self.client.get('/api/crops/recommendations/').status_code,409)

    def test_gaez_uses_saved_pin_and_no_substitute_species(self):
        self.client.post('/',{'action':'location','latitude':18,'longitude':102.6});field=Field.objects.first()
        pin=pin_id(field)
        self.assertEqual(self.client.get('/api/crops/gaez/?crop=mung-bean&pin='+pin).json()['status'],'not_available')
        self.assertEqual(self.client.get('/api/crops/gaez/?crop=rice&pin=old').status_code,409)
        self.assertEqual(self.client.get('/api/crops/gaez/?crop=https://fake.example&pin='+pin).status_code,400)
        self.assertEqual(self.client.get('/api/gaez/automatic/').status_code,404)
