from copy import deepcopy
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase, SimpleTestCase
from django.utils import timezone

from .market_data import catalogue, reference_for_crop, numeric_range, parse_sheet, DIRECTORY
from . import market_rates


class SheetImportTests(SimpleTestCase):
    def test_all_source_rows_and_original_information_are_preserved(self):
        data=catalogue()
        self.assertEqual(data['source_rows'],59)
        self.assertEqual(data['product_count'],60)
        self.assertEqual(len(data['groups']),5)
        self.assertEqual(len({crop['id'] for crop in data['crops']}),60)
        for crop in data['crops']:
            self.assertEqual(len(crop['raw_row']),12)
            self.assertEqual(set(crop['seasons']),{'Laos','Thailand','Myanmar','Vietnam','Cambodia'})
            self.assertTrue(crop['source_url'].endswith(f"range=A{crop['source_row']}:L{crop['source_row']}"))
        self.assertIsNone(data['source']['survey_date'])
        self.assertFalse(data['source']['independent_verification'])

    def test_combined_cassava_row_is_split_without_borrowing_sweet_potato_price(self):
        crops={crop['id']:crop for crop in catalogue()['crops']}
        self.assertEqual(crops['47-cassava']['laos_price'],[2800,3500])
        self.assertIsNone(crops['47-cassava']['world_price'])
        self.assertEqual(crops['47-cassava']['growing_days'],[240,300])
        self.assertEqual(crops['47-sweet-potato']['laos_price'],[12000,18000])
        self.assertEqual(crops['47-sweet-potato']['world_price'],[.6,1.1])
        self.assertEqual(crops['47-sweet-potato']['growing_days'],[100,120])
        self.assertEqual(crops['47-cassava']['source_row'],53)

    def test_crop_matches_keep_species_and_variety_distinctions(self):
        self.assertEqual(reference_for_crop('maize')['entries'][0]['id'],'36')
        self.assertEqual(reference_for_crop('cassava')['entries'][0]['laos_price'],[2800,3500])
        self.assertEqual(len(reference_for_crop('tomato')['entries']),3)
        for absent in ('banana','rice','peanut','mung-bean','soybean','arabica-coffee','robusta-coffee'):
            self.assertEqual(reference_for_crop(absent)['status'],'not_in_sheet')
            self.assertEqual(reference_for_crop(absent)['entries'],[])

    def test_ranges_reject_ambiguous_or_inverted_cells_and_bad_schema(self):
        self.assertEqual(numeric_range('25,000 - 35,000'),[25000,35000])
        self.assertIsNone(numeric_range('35,000 - 25,000'))
        self.assertIsNone(numeric_range('10 - 20 / 30 - 40'))
        self.assertIsNone(numeric_range('10 - 20 (different products)'))
        with self.assertRaises(ValueError):parse_sheet(b'name,price\nplant,2')

    @patch('website.market_data.catalogue')
    def test_row_renumbering_cannot_assign_a_different_product_to_maize(self, load):
        data=deepcopy(catalogue())
        for crop in data['crops']:
            if crop['name']=='Field Corn / Maize':crop['id']='new-row-id'
        load.return_value=data
        self.assertEqual(reference_for_crop('maize')['entries'][0]['id'],'new-row-id')

    @patch('website.market_data.catalogue',side_effect=ValueError)
    def test_optional_market_failure_does_not_break_suitability(self, load):
        self.assertEqual(reference_for_crop('cassava')['status'],'unavailable')


class ExchangeRateTests(SimpleTestCase):
    def payload(self):
        day=timezone.localdate().isoformat()
        return [{'base':'USD','quote':'LAK','rate':20000,'date':day},
                {'base':'USD','quote':'THB','rate':35,'date':day}]

    def test_reference_schema_supports_cross_currency_math(self):
        data=market_rates.parse_rates(self.payload())
        rates=data['rates']
        self.assertEqual(30000*rates['USD']/rates['LAK'],1.5)
        self.assertEqual(30000*rates['THB']/rates['LAK'],52.5)
        self.assertEqual(2*rates['LAK']/rates['USD'],40000)
        self.assertIn('LAK',data['dates'])

    def test_invalid_missing_old_and_future_rates_are_rejected(self):
        for invalid in (0,-1,float('nan'),True):
            data=self.payload();data[0]['rate']=invalid
            with self.assertRaises(ValueError):market_rates.parse_rates(data)
        for change in (timedelta(days=-8),timedelta(days=2)):
            data=self.payload();data[0]['date']=(timezone.localdate()+change).isoformat()
            with self.assertRaises(ValueError):market_rates.parse_rates(data)
        with self.assertRaises(ValueError):market_rates.parse_rates(self.payload()[:1])
        data=self.payload()+self.payload()[:1]
        with self.assertRaises(ValueError):market_rates.parse_rates(data)

    @patch.object(market_rates,'urlopen',side_effect=TimeoutError)
    @patch.object(market_rates.cache,'set')
    @patch.object(market_rates.cache,'get')
    def test_outage_uses_only_valid_dated_saved_rates(self, get, save, read):
        previous=market_rates.parse_rates(self.payload())
        get.side_effect=[None,previous]
        self.assertEqual(market_rates.get_rates()['status'],'stale')
        previous=deepcopy(previous)
        previous['dates']['LAK']=(timezone.localdate()-timedelta(days=8)).isoformat()
        get.side_effect=[None,previous]
        result=market_rates.get_rates()
        self.assertEqual(result['status'],'unavailable')
        self.assertEqual(result['rates'],{})


class MarketEndpointTests(TestCase):
    def test_catalogue_and_currency_endpoint_are_read_only_and_market_is_replaced(self):
        response=self.client.get('/api/market/')
        self.assertEqual(response.status_code,200)
        self.assertEqual(len(response.json()['crops']),60)
        self.assertEqual(self.client.post('/api/market/',{}).status_code,405)
        page=self.client.get('/map/')
        self.assertContains(page,'id="market-currency"')
        self.assertNotContains(page,'Local buying prices are not connected yet.')
        with patch('website.views.get_rates',return_value={'status':'unavailable','rates':{}}):
            response=self.client.get('/api/market/rates/')
            self.assertEqual(response.json()['rates'],{})
            self.assertEqual(response['Cache-Control'],'no-store')
