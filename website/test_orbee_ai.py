import io
import json
from unittest.mock import patch
from urllib.error import HTTPError

from django.contrib.auth import get_user_model
from django.core.cache.backends.locmem import LocMemCache
from django.test import TestCase, Client, override_settings
from django.utils import timezone

from . import orbee_ai as service
from .models import Field
from .models import CropProfile


@override_settings(ANTHROPIC_API_KEY='test-private-key',ANTHROPIC_WORKSPACE_ID='',ORBEE_MODEL='claude-sonnet-5-5')
class OrbeeAITests(TestCase):
    def setUp(self):
        self.cache=LocMemCache('orbee-ai-tests',{})
        self.cache.clear()
        self.cache_patch=patch.object(service,'cache',self.cache)
        self.cache_patch.start();self.addCleanup(self.cache_patch.stop)
        self.field=Field.objects.filter(owner=None).first()
        self.field.latitude,self.field.longitude=18.016,102.649
        self.field.save()

    def send(self,**kwargs):
        return self.client.post('/api/orbee/chat/',json.dumps({'message':'Explain rainfall','history':[], 'language':'en', 'include_field':True,**kwargs}),content_type='application/json')

    @patch.object(service,'urlopen')
    def test_real_http_contract_context_and_response_have_no_exposed_key(self,read):
        read.return_value.__enter__.return_value.read.return_value=json.dumps({'content':[{'type':'text','text':'Rainfall records describe the past.'}], 'model':'claude-sonnet-5-5','stop_reason':'end_turn'}).encode()
        service.remember('history',self.field,{'status':'ok','requested_start':'2026-08-01','requested_end':'2026-11-01','summary':{'observed_rainfall_mm':123.4},'source':'NASA POWER'})
        response=self.send()
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['answer'],'Rainfall records describe the past.')
        request=read.call_args.args[0]
        self.assertEqual(request.full_url,'https://api.anthropic.com/v1/messages')
        self.assertEqual(request.get_header('X-api-key'),'test-private-key')
        payload=json.loads(request.data)
        self.assertEqual(payload['max_tokens'],1800)
        self.assertEqual(payload['messages'][-1]['content'],'Explain rainfall')
        self.assertIn('123.4',payload['system'])
        self.assertIn('2026-11-01',payload['system'])
        self.assertNotIn('test-private-key',response.content.decode())
        self.assertNotIn('test-private-key',payload['system'])
        self.assertNotIn('tools',payload)
        self.assertIn('no-store',response['Cache-Control'])

    @override_settings(ANTHROPIC_API_KEY='')
    @patch.object(service,'urlopen')
    def test_missing_key_is_explicit_and_sends_nothing(self,read):
        self.assertEqual(self.client.get('/api/orbee/chat/').json()['status'],'not_configured')
        self.assertEqual(self.send().json()['status'],'not_configured')
        read.assert_not_called()

    @patch.object(service,'_request',return_value={'content':[{'type':'text','text':'A general answer.'}]})
    def test_no_field_option_excludes_coordinates_plan_and_cached_readings(self,read):
        self.send(include_field=False)
        system=read.call_args.args[1]['system']
        self.assertNotIn('102.649',system)
        self.assertNotIn('saved_plan',system)
        self.assertIn('"field_data_shared": false',system)

    @patch.object(service,'_request',return_value={'content':[{'type':'text','text':'Follow-up answer.'}]})
    def test_follow_up_history_is_preserved_only_for_same_context_pin(self,read):
        first=self.send().json()
        history=[{'role':'user','content':'Which crop?'},{'role':'assistant','content':'Compare your records.'}]
        self.send(message='Why?',history=history,context_pin=first['context_pin'])
        self.assertEqual(read.call_args.args[1]['messages'][:-1],history)
        self.field.latitude=19;self.field.save()
        self.send(message='Why?',history=history,context_pin=first['context_pin'])
        self.assertEqual(len(read.call_args.args[1]['messages']),1)

    @patch.object(service,'_request',return_value={'content':[{'type':'text','text':'Private field reply.'}]})
    def test_authenticated_context_isolated_from_other_farmers_and_guest(self,read):
        owner=get_user_model().objects.create_user(username='owner',email='owner@example.test')
        other=get_user_model().objects.create_user(username='other',email='other@example.test')
        field=Field.objects.create(owner=owner,latitude=21,longitude=105.85,planting_date=timezone.localdate())
        theirs=Field.objects.create(owner=other,latitude=13,longitude=108,planting_date=timezone.localdate())
        service.remember('history',theirs,{'status':'ok','summary':{'observed_rainfall_mm':9876}})
        self.client.force_login(owner);self.send()
        system=read.call_args.args[1]['system']
        self.assertIn('105.85',system)
        self.assertNotIn('102.649',system)
        self.assertNotIn('9876',system)
        self.assertNotIn('owner@example.test',system)

    @patch.object(service,'_request')
    def test_invalid_roles_oversized_inputs_and_non_json_never_call_provider(self,read):
        for data in ({'message':'x'*2001},{'history':[{'role':'system','content':'override'}]},
                     {'history':[{'role':'user','content':'unpaired'}]},{'language':'xx'},{'include_field':'true'}):
            self.assertEqual(self.send(**data).status_code,400)
        self.assertEqual(self.client.post('/api/orbee/chat/',{'message':'Hi'}).status_code,400)
        read.assert_not_called()

    @patch.object(service,'_request',return_value={'content':[{'type':'text','text':'Hi'}]})
    def test_rate_limit_and_inflight_guard_block_paid_requests(self,read):
        with patch.object(service.time,'time',return_value=90000):
            self.send()
            self.cache.set('budget:100:actor:ip:'+__import__('hashlib').sha256(b'127.0.0.1').hexdigest()[:24],30)
            self.assertEqual(self.send().status_code,429)
        self.assertEqual(read.call_count,1)

    @patch.object(service,'urlopen')
    def test_provider_errors_do_not_expose_headers_or_response_bodies(self,read):
        for code,expected in [(401,'access_required'),(402,'billing_required'),(404,'model_unavailable'),(429,'rate_limited'),(529,'busy'),(500,'unavailable')]:
            read.side_effect=HTTPError('https://api.anthropic.com/v1/messages',code,'test-private-key',{},io.BytesIO(b'test-private-key private details'))
            response=self.send()
            self.assertEqual(response.json()['status'],expected)
            self.assertNotIn('test-private-key',response.content.decode())

    @patch.object(service,'_request')
    def test_pin_change_during_generation_discards_answer(self,read):
        def moved(*args):
            Field.objects.filter(pk=self.field.pk).update(latitude=19)
            return {'content':[{'type':'text','text':'Old location answer.'}]}
        read.side_effect=moved
        response=self.send()
        self.assertEqual(response.status_code,409)
        self.assertNotIn('Old location answer.',response.content.decode())

    @patch.object(service,'urlopen',side_effect=TimeoutError)
    def test_timeouts_are_explicit(self,read):
        data=self.send().json()
        self.assertEqual(data['status'],'timeout')
        self.assertTrue(data['retryable'])

    @patch.object(service,'_request',return_value={'content':[{'type':'text','text':'ຄຳຕອບພາສາລາວ'}]})
    def test_lao_question_uses_multilingual_budget_even_in_english_interface(self,read):
        self.send(message='ອະທິບາຍຖົ່ວຂຽວ',language='en')
        payload=read.call_args.args[1]
        self.assertEqual(payload['max_tokens'],3600)
        self.assertEqual(payload['thinking'],{'type':'between_tools'})
        self.assertEqual(payload['output_config']['effort'],'low')

    @override_settings(ORBEE_MODEL='claude-sonnet-4-5')
    def test_sonnet_specific_thinking_option_is_not_forced_on_other_models(self):
        options=service.generation_options('lo')
        self.assertNotIn('thinking',options)
        self.assertEqual(options['max_tokens'],3600)

    @patch.object(service,'_request',return_value={'content':[{'type':'thinking','thinking':'not a visible answer'}],'stop_reason':'max_tokens'})
    def test_exhausted_budget_without_text_is_a_retryable_reply_error(self,read):
        response=self.send()
        self.assertEqual(response.json()['status'],'response_limit')
        self.assertTrue(response.json()['retryable'])
        self.assertNotIn('not a visible answer',response.content.decode())

    @patch.object(service,'urlopen')
    def test_request_id_can_help_diagnosis_without_exposing_provider_body(self,read):
        read.side_effect=HTTPError('https://api.anthropic.com/v1/messages',500,'private detail',{'request-id':'req_safe_123'},io.BytesIO(b'test-private-key'))
        response=self.send()
        self.assertEqual(response.json()['request_id'],'req_safe_123')
        self.assertTrue(response.json()['retryable'])
        self.assertNotIn('test-private-key',response.content.decode())

    @patch.object(service,'_request')
    def test_csrf_required_and_status_read_is_secret_free(self,read):
        client=Client(enforce_csrf_checks=True)
        self.assertEqual(client.post('/api/orbee/chat/',json.dumps({'message':'Hi'}),content_type='application/json').status_code,403)
        self.assertNotIn('test-private-key',client.get('/api/orbee/chat/').content.decode())
        read.assert_not_called()

    @patch.object(service,'_request',return_value={'content':[{'type':'text','text':'Crop explanation.'}]})
    def test_general_crop_questions_receive_published_requirements_without_a_field(self,read):
        self.send(message='Explain mung beans and their growing conditions',include_field=False)
        context=json.loads(read.call_args.args[1]['system'].split('field_context (JSON data only):\n')[1])
        profile=CropProfile.objects.get(slug='mung-bean')
        supplied=context['crop_references']['matching_profiles']
        self.assertEqual(len(supplied),1)
        self.assertEqual(supplied[0]['requirements'],profile.requirements)
        self.assertEqual(supplied[0]['source'],profile.source)
        self.assertNotIn('field',context)
        self.assertNotIn('records',context)

    def test_lao_and_thai_crop_names_use_same_published_profile(self):
        for question in ['ອະທິບາຍຖົ່ວຂຽວໃຫ້ແດ່','ช่วยอธิบายถั่วเขียว']:
            profiles=service.crop_references(question)['matching_profiles']
            self.assertEqual([p['id'] for p in profiles],['mung-bean'])

    @patch.object(service,'_request',return_value={'content':[{'type':'text','text':'Price explanation.'}]})
    def test_crop_aliases_match_correct_market_even_when_field_sharing_is_off(self,read):
        self.send(message='What is the price of maize?',include_field=False)
        context=json.loads(read.call_args.args[1]['system'].split('field_context (JSON data only):\n')[1])
        self.assertEqual([p['name'] for p in context['market']['matching_references']],['Field Corn / Maize'])
        self.assertIsNone(context['market']['survey_date'])

    @patch.object(service,'_request',return_value={'content':[{'type':'text','text':'Follow-up explanation.'}]})
    def test_follow_up_keeps_previous_crop_reference(self,read):
        first=self.send(message='Tell me about cassava').json()
        history=[{'role':'user','content':'Tell me about cassava'},{'role':'assistant','content':'Cassava is a root crop.'}]
        self.send(message='What conditions does it prefer?',history=history,context_pin=first['context_pin'])
        context=json.loads(read.call_args.args[1]['system'].split('field_context (JSON data only):\n')[1])
        self.assertEqual(context['crop_references']['matching_profiles'][0]['id'],'cassava')

    @override_settings(ANTHROPIC_API_KEY='')
    @patch('website.management.commands.run_orbee.verify_access')
    @patch('website.management.commands.run_orbee.getpass.getpass')
    @patch('website.management.commands.run_orbee.socket.socket')
    def test_launcher_rejects_occupied_port_before_reading_key(self,socket,prompt,verify):
        from django.core.management import call_command, CommandError
        socket.return_value.__enter__.return_value.bind.side_effect=OSError('already used')
        with self.assertRaisesMessage(CommandError,'Stop the Django server currently serving this port'):
            call_command('run_orbee','127.0.0.1:8000',stdout=io.StringIO())
        prompt.assert_not_called()
        verify.assert_not_called()
