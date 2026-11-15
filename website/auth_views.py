"""Working optional farmer accounts; the public map remains available."""
import hashlib

from django.contrib.auth import login
from django.conf import settings
from django.contrib.auth.views import LoginView, LogoutView
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.shortcuts import redirect, render
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.debug import sensitive_post_parameters
from django.views.decorators.http import require_http_methods

from .authentication import EmailLoginForm, FarmerSignupForm


def attempt_key(request):
    # Use the direct client address, not a client-controlled forwarded header.
    return 'mekongrise-auth:' + hashlib.sha256(request.META.get('REMOTE_ADDR', '').encode()).hexdigest()


def blocked(request):
    return cache.get(attempt_key(request), 0) >= 15


def record_failure(request):
    key = attempt_key(request)
    if not cache.add(key, 1, 300):
        try:
            cache.incr(key)
        except ValueError:
            cache.set(key, 1, 300)


class FarmerLoginView(LoginView):
    template_name = 'website/auth.html'
    authentication_form = EmailLoginForm
    redirect_authenticated_user = True

    def post(self, request, *args, **kwargs):
        if blocked(request):
            form = self.get_form_class()(request=request, data={})
            form.errors.clear()
            form.add_error(None, 'Too many attempts. Please wait five minutes and try again.')
            return self.render_to_response(self.get_context_data(form=form), status=429)
        return super().post(request, *args, **kwargs)

    def form_invalid(self, form):
        record_failure(self.request)
        return super().form_invalid(form)

    def form_valid(self, form):
        result = super().form_valid(form)
        self.request.session.set_expiry(settings.SESSION_COOKIE_AGE)
        cache.delete(attempt_key(self.request))
        return result


class FarmerLogoutView(LogoutView):
    next_page = 'login'


@never_cache
@sensitive_post_parameters('password1', 'password2')
@csrf_protect
@require_http_methods(['GET', 'POST'])
def signup(request):
    if request.user.is_authenticated:
        return redirect('home')
    form = FarmerSignupForm(request.POST if request.method == 'POST' else None)
    response_status = 200
    if request.method == 'POST':
        if blocked(request):
            form = FarmerSignupForm(data={})
            form.errors.clear()
            form.add_error(None, 'Too many attempts. Please wait five minutes and try again.')
            response_status = 429
        elif form.is_valid():
            try:
                with transaction.atomic():
                    user = form.save()
            except IntegrityError:
                form.add_error(None, 'An account with these contact details already exists. Please sign in.')
                record_failure(request)
            else:
                login(request, user, backend='website.authentication.EmailBackend')
                request.session.set_expiry(settings.SESSION_COOKIE_AGE)
                cache.delete(attempt_key(request))
                destination = request.POST.get('next', '')
                if not url_has_allowed_host_and_scheme(destination, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
                    destination = reverse('home')
                return redirect(destination or reverse('home'))
        else:
            record_failure(request)
    return render(request, 'website/auth.html', {'form': form, 'signup': True, 'next': request.POST.get('next', request.GET.get('next', ''))}, status=response_status)
