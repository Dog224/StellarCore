from datetime import date
from unittest.mock import patch

from django.contrib.auth import authenticate, get_user_model
from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from .auth_views import attempt_key
from .models import Field, FarmEvent, FarmerProfile


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class FarmerAccountTests(TestCase):
    """Fast test-only hashing; deployment retains Django's configured hashers."""
    password = 'River-orchard!5836'

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.user = get_user_model().objects.create_user(username='farmer-one', email='farmer@example.test', password=self.password)

    def test_login_signup_and_guest_map_are_available(self):
        for path in ('/login/', '/signup/', '/map/'):
            self.assertEqual(self.client.get(path).status_code, 200)
        page = self.client.get('/login/')
        self.assertContains(page, 'MekongRise')
        self.assertContains(page, 'Save Water. Breathe Clean. Earn More.')
        self.assertContains(page, 'Continue as guest')
        self.assertContains(page, 'login-farm.jpg')

    def test_email_login_sets_a_persistent_secure_session(self):
        self.client.get('/login/')
        response = self.client.post('/login/', {'username':'FARMER@EXAMPLE.TEST', 'password':self.password})
        self.assertRedirects(response, '/map/')
        self.assertEqual(int(self.client.session['_auth_user_id']), self.user.pk)
        self.assertFalse(self.client.session.get_expire_at_browser_close())
        self.assertEqual(self.client.session.get_expiry_age(), 2592000)
        self.assertEqual(self.client.cookies['sessionid']['samesite'], 'Lax')
        self.assertTrue(self.client.cookies['sessionid']['httponly'])

    def test_default_login_persists_after_browser_closes(self):
        self.client.post('/login/', {'username':self.user.email, 'password':self.password})
        self.assertFalse(self.client.session.get_expire_at_browser_close())

    def test_entry_routes_new_visitors_to_login_and_returning_accounts_to_map(self):
        self.assertRedirects(self.client.get('/'), '/login/')
        self.assertContains(self.client.get('/map/'), 'Guest mode')
        self.client.post('/login/', {'username':self.user.email, 'password':self.password})
        returning = Client()
        returning.cookies['sessionid'] = self.client.cookies['sessionid'].value
        self.assertRedirects(returning.get('/'), '/map/')
        self.assertRedirects(returning.get('/login/'), '/map/')
        self.assertTrue(self.client.cookies['sessionid']['expires'])
        returning.post('/logout/')
        self.assertRedirects(returning.get('/'), '/login/')
        # A copied old cookie cannot revive a session invalidated by sign-out.
        self.assertRedirects(self.client.get('/'), '/login/')

    def test_phone_only_signup_and_national_or_international_login(self):
        response = self.client.post('/signup/', {'phone':'020 5555 1234', 'password1':self.password, 'password2':self.password})
        self.assertRedirects(response, '/map/')
        profile = FarmerProfile.objects.get(phone='+8562055551234')
        self.assertEqual(profile.user.email, '')
        self.assertTrue(profile.user.check_password(self.password))
        for number in ('02055551234', '+856 20 5555 1234'):
            self.client.post('/logout/')
            self.assertRedirects(self.client.post('/login/', {'username':number, 'password':self.password}), '/map/')
            self.assertEqual(int(self.client.session['_auth_user_id']), profile.user_id)

    def test_both_contacts_sign_in_to_same_account_and_profile_is_private(self):
        response = self.client.post('/signup/', {'email':'both@gmail.com', 'phone':'+8562055551234', 'password1':self.password, 'password2':self.password})
        self.assertRedirects(response, '/map/')
        user = get_user_model().objects.get(email='both@gmail.com')
        self.assertEqual(authenticate(username='BOTH@GMAIL.COM', password=self.password), user)
        self.assertEqual(authenticate(username='02055551234', password=self.password), user)
        page = self.client.get('/map/')
        self.assertContains(page, 'class="profile-button"')
        self.assertContains(page, 'id="profile-dialog"')
        self.assertContains(page, '+8562055551234')
        self.assertContains(page, 'both@gmail.com')
        self.assertNotContains(page, 'class="account-button"')
        self.client.post('/logout/')
        page = self.client.get('/map/')
        self.assertContains(page, 'class="account-button"')
        self.assertNotContains(page, 'id="profile-dialog"')
        self.assertNotContains(page, 'both@gmail.com')
        self.assertNotContains(page, '+8562055551234')

    def test_signup_rejects_missing_invalid_and_duplicate_phone_contacts(self):
        FarmerProfile.objects.create(user=self.user, phone='+8562055551234')
        for contacts in ({}, {'phone':'123'}, {'phone':'020 5555 1234'}, {'phone':'+8562055551234'}, {'email':'invalid'}):
            response = self.client.post('/signup/', {**contacts, 'password1':self.password, 'password2':self.password})
            self.assertEqual(response.status_code, 200)
            self.assertNotIn('_auth_user_id', self.client.session)
        self.assertEqual(get_user_model().objects.count(), 1)
        self.assertEqual(FarmerProfile.objects.count(), 1)

    def test_invalid_login_does_not_authenticate_or_echo_password(self):
        response = self.client.post('/login/', {'username':self.user.email, 'password':'incorrect!secret'})
        self.assertContains(response, 'The email, phone number or password is incorrect.')
        self.assertNotContains(response, 'incorrect!secret')
        self.assertNotIn('_auth_user_id', self.client.session)
        self.user.is_active = False
        self.user.save()
        response = self.client.post('/login/', {'username':self.user.email, 'password':self.password})
        self.assertContains(response, 'The email, phone number or password is incorrect.')
        self.assertNotIn('_auth_user_id', self.client.session)

    def test_admin_usernames_and_legacy_email_usernames_still_work(self):
        self.assertEqual(authenticate(username='farmer-one', password=self.password), self.user)
        legacy = get_user_model().objects.create_user(username='legacy@example.test', password=self.password)
        self.assertEqual(authenticate(username=legacy.username, password=self.password), legacy)

    def test_ambiguous_email_never_selects_an_arbitrary_account(self):
        get_user_model().objects.create_user(username='second', email=self.user.email, password=self.password)
        self.assertIsNone(authenticate(username=self.user.email, password=self.password))

    def test_signup_hashes_password_logs_in_and_creates_a_separate_workspace(self):
        legacy = Field.objects.first()
        legacy.latitude, legacy.longitude = 18, 102.6
        legacy.save()
        response = self.client.post('/signup/', {'email':'New-Farmer@example.test', 'password1':self.password, 'password2':self.password})
        self.assertRedirects(response, '/map/')
        user = get_user_model().objects.get(email='new-farmer@example.test')
        self.assertNotEqual(user.password, self.password)
        self.assertTrue(user.check_password(self.password))
        self.assertFalse(user.is_staff)
        self.assertEqual(int(self.client.session['_auth_user_id']), user.pk)
        field = Field.objects.get(owner=user)
        self.assertIsNone(field.latitude)
        self.assertIsNone(field.area)
        legacy.refresh_from_db()
        self.assertIsNone(legacy.owner)
        self.assertEqual(float(legacy.latitude), 18)

    def test_signup_rejects_duplicate_weak_and_mismatching_credentials(self):
        for values in [
            {'email':'FARMER@EXAMPLE.TEST','password1':self.password,'password2':self.password},
            {'email':'new@example.test','password1':'123','password2':'123'},
            {'email':'new@example.test','password1':self.password,'password2':'different'},
        ]:
            self.assertEqual(self.client.post('/signup/', values).status_code, 200)
        self.assertEqual(get_user_model().objects.count(), 1)
        self.assertNotIn('_auth_user_id', self.client.session)

    def test_auth_forms_and_logout_require_csrf_and_logout_is_post_only(self):
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(client.post('/login/', {'username':self.user.email,'password':self.password}).status_code, 403)
        self.assertEqual(client.post('/signup/', {}).status_code, 403)
        client.force_login(self.user)
        self.assertEqual(client.get('/logout/').status_code, 405)
        self.assertEqual(client.post('/logout/').status_code, 403)
        client.get('/map/')
        csrf = client.cookies['csrftoken'].value
        self.assertEqual(client.post('/logout/', {'csrfmiddlewaretoken':csrf}).status_code, 302)
        self.assertNotIn('_auth_user_id', client.session)

    def test_next_redirect_is_local_for_login_and_signup(self):
        response = self.client.post('/login/?next=https://example.org/steal', {'username':self.user.email,'password':self.password})
        self.assertEqual(response['Location'], '/map/')
        self.client.logout()
        response = self.client.post('/login/?next=/%23calendar', {'username':self.user.email,'password':self.password})
        self.assertEqual(response['Location'], '/#calendar')
        self.client.logout()
        response = self.client.post('/signup/', {'email':'safe@example.test','password1':self.password,'password2':self.password,'next':'//example.org/steal'})
        self.assertEqual(response['Location'], '/map/')

    def test_too_many_failed_attempts_are_limited_for_login_and_signup(self):
        from django.test import RequestFactory
        key = attempt_key(RequestFactory().post('/login/'))
        cache.set(key, 15, 300)
        response = self.client.post('/login/', {'username':self.user.email,'password':self.password})
        self.assertEqual(response.status_code, 429)
        self.assertContains(response, 'Too many attempts.', status_code=429)
        self.assertNotIn('_auth_user_id', self.client.session)
        self.assertEqual(self.client.post('/signup/', {}).status_code, 429)

    def test_fields_events_and_completion_are_isolated_between_users_and_guests(self):
        self.client.force_login(self.user)
        self.client.get('/map/')
        field = Field.objects.get(owner=self.user)
        response = self.client.post('/', {'action':'location','latitude':'18','longitude':'102.6'})
        self.assertEqual(response.status_code, 200)
        self.client.post('/', {'action':'event','title':'Private planting','date':'2026-11-20'})
        event = FarmEvent.objects.get(owner=self.user)
        other = get_user_model().objects.create_user(username='farmer-two',email='two@example.test',password=self.password)
        other_client = Client()
        other_client.force_login(other)
        response = other_client.get('/api/dashboard/')
        self.assertIsNone(response.json()['field']['latitude'])
        self.assertEqual(response.json()['events'], [])
        other_client.post('/', {'action':'complete','event_id':event.pk})
        self.client.logout()
        self.assertIsNone(self.client.get('/api/dashboard/').json()['field']['latitude'])
        self.assertEqual(self.client.get('/api/dashboard/').json()['events'], [])
        self.client.post('/', {'action':'complete','event_id':event.pk})
        event.refresh_from_db()
        self.assertFalse(event.completed)
        self.client.force_login(self.user)
        self.client.post('/', {'action':'complete','event_id':event.pk})
        event.refresh_from_db()
        self.assertTrue(event.completed)
        field.refresh_from_db()
        self.assertEqual(float(field.latitude), 18)

    @patch('website.views.get_history')
    def test_provider_endpoints_use_the_signed_in_farm_not_another_users_pin(self, service):
        public = Field.objects.first()
        public.latitude, public.longitude = 18, 102.6
        public.save()
        self.client.force_login(self.user)
        self.client.get('/map/')
        field = Field.objects.get(owner=self.user)
        field.latitude, field.longitude = 15.18, 106.23
        field.save()
        service.return_value = {'status':'ok'}
        response = self.client.get('/api/weather/history/?latitude=0&longitude=0')
        self.assertEqual(response.json()['latitude'], 15.18)
        self.assertEqual(service.call_args.args[0].owner_id, self.user.pk)
