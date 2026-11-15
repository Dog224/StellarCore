"""Email and phone sign-in using Django's password hashing and session authentication."""
import hashlib

from django import forms
from django.contrib.auth import get_user_model, password_validation
from django.contrib.auth.backends import ModelBackend
from django.contrib.auth.forms import AuthenticationForm
from django.db.models import Q
from django.core.validators import validate_email
from .phone_numbers import normalize_phone
from .models import FarmerProfile


class EmailBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        User = get_user_model()
        identifier = username or kwargs.get(User.USERNAME_FIELD)
        if identifier is None or password is None:
            return None
        identifier = str(identifier).strip()
        if '@' not in identifier:
            try:
                phone = normalize_phone(identifier)
            except ValueError:
                # Retain normal username authentication for the Django admin.
                return super().authenticate(request, username=identifier, password=password, **kwargs)
            matches = list(User._default_manager.filter(Q(farmer_profile__phone=phone) | Q(username=identifier))[:2])
        else:
            matches = list(User._default_manager.filter(Q(email__iexact=identifier.casefold()) | Q(username=identifier))[:2])
        if len(matches) != 1:
            User().set_password(password)
            return None
        user = matches[0]
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None


class EmailLoginForm(AuthenticationForm):
    username = forms.CharField(label='Email or phone number', max_length=254, widget=forms.TextInput(attrs={
        'autocomplete': 'username', 'placeholder': 'Email or phone number', 'autofocus': True,
        'spellcheck': 'false', 'autocapitalize': 'none',
    }))
    password = forms.CharField(label='Password', strip=False, widget=forms.PasswordInput(attrs={
        'autocomplete': 'current-password', 'placeholder': 'Enter your password',
    }))
    error_messages = {
        'invalid_login': 'The email, phone number or password is incorrect. Please try again.',
        'inactive': 'The email, phone number or password is incorrect. Please try again.',
    }

    def clean_username(self):
        value = self.cleaned_data['username'].strip()
        if '@' in value:
            validate_email(value)
        else:
            try:
                normalize_phone(value)
            except ValueError as error:
                raise forms.ValidationError('Enter a valid email address or phone number.') from error
        return value


class FarmerSignupForm(forms.Form):
    email = forms.EmailField(label='Email address', max_length=254, required=False, widget=forms.EmailInput(attrs={
        'autocomplete': 'email', 'placeholder': 'you@example.com', 'autofocus': True, 'spellcheck': 'false',
    }))
    phone = forms.CharField(label='Phone number', max_length=40, required=False, widget=forms.TextInput(attrs={
        'type': 'tel', 'autocomplete': 'tel', 'placeholder': '020 5555 1234',
    }))
    password1 = forms.CharField(label='Password', strip=False, widget=forms.PasswordInput(attrs={
        'autocomplete': 'new-password', 'placeholder': 'Create a password', 'minlength': 8,
    }))
    password2 = forms.CharField(label='Confirm password', strip=False, widget=forms.PasswordInput(attrs={
        'autocomplete': 'new-password', 'placeholder': 'Enter your password again',
    }))

    @staticmethod
    def username_for(email):
        return 'mr_' + hashlib.sha256(email.casefold().encode()).hexdigest()

    def clean_email(self):
        email = self.cleaned_data['email'].strip().casefold()
        if not email:
            return ''
        User = get_user_model()
        if User._default_manager.filter(Q(email__iexact=email) | Q(username__iexact=email) | Q(username=self.username_for(email))).exists():
            raise forms.ValidationError('An account with this email already exists. Please sign in.')
        return email

    def clean_phone(self):
        raw = self.cleaned_data.get('phone', '').strip()
        if not raw:
            return ''
        try:
            phone = normalize_phone(raw)
        except ValueError as error:
            raise forms.ValidationError('Enter a valid phone number.') from error
        if (FarmerProfile.objects.filter(phone=phone).exists() or
                get_user_model().objects.filter(username__in=[raw, phone, self.username_for(phone)]).exists()):
            raise forms.ValidationError('An account with this phone number already exists. Please sign in.')
        return phone

    def clean(self):
        values = super().clean()
        if not values.get('email') and not values.get('phone'):
            self.add_error(None, 'Enter an email address or phone number to create your account.')
        password, confirmation = values.get('password1'), values.get('password2')
        if password and confirmation and password != confirmation:
            self.add_error('password2', 'The passwords do not match.')
        if password:
            user = get_user_model()(email=values.get('email', ''), username=self.username_for(values.get('email', '')))
            try:
                password_validation.validate_password(password, user=user)
            except forms.ValidationError as error:
                self.add_error('password1', error)
        return values

    def save(self):
        email = self.cleaned_data.get('email', '')
        phone = self.cleaned_data.get('phone', '')
        user = get_user_model()._default_manager.create_user(
            username=self.username_for(email or phone), email=email, password=self.cleaned_data['password1'],
        )
        FarmerProfile.objects.create(user=user, phone=phone or None)
        return user
