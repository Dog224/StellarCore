import calendar
from datetime import date, timedelta
from django.contrib import messages
from django.http import JsonResponse, HttpResponse
from django.shortcuts import redirect, render
from django.utils import timezone
from .forms import FieldForm, EventForm, LocationForm, AssessmentForm
from .models import Field, FarmEvent
from .nasa_power import get_field_weather
from django.views.decorators.http import require_GET
from django.conf import settings
from django.urls import reverse
from django.views.decorators.cache import never_cache
from .assessment import assess_crop
from .gaez import catalogue, initial_selection, get_point, DEFAULTS
from .crop_recommendations import recommend
from .crop_environment import pin_id
from .models import CropProfile, FarmerProfile
from .region import map_region, contains_location
from .weather_history import get_history, PERIODS
from .place_context import get_place
from .home_conditions import get_conditions
from .market_data import catalogue as market_catalogue
from .market_rates import get_rates
from .farms import current_field, farm_events
from .orbee_ai import remember as remember_orbee
from .copernicus import catalogue_at_pin, vegetation_at_pin, vegetation_image, CopernicusError


@never_cache
def entry(request):
    # Preserve the existing pin-save POST URL while making first visits login-first.
    if request.method == 'POST':
        return home(request)
    return redirect('home' if request.user.is_authenticated else 'login')


@never_cache
def home(request, workspace_page=None):
    if request.user.is_authenticated and request.session.get_expire_at_browser_close():
        request.session.set_expiry(settings.SESSION_COOKIE_AGE)
    today = timezone.localdate()
    field = current_field(request)
    field_form, event_form = FieldForm(instance=field), EventForm()
    active_dialog = ''
    if request.method == 'POST':
        action = request.POST.get('action')
        if action == 'location':
            form = LocationForm(request.POST)
            if not form.is_valid():
                return JsonResponse({'errors': form.errors}, status=400)
            if not field:
                return JsonResponse({'error': 'Save your field settings first.'}, status=400)
            field.latitude = form.cleaned_data['latitude']
            field.longitude = form.cleaned_data['longitude']
            field.save(update_fields=['latitude', 'longitude'])
            return JsonResponse({'latitude': float(field.latitude), 'longitude': float(field.longitude)})
        elif action == 'field':
            field_form = FieldForm(request.POST, instance=field)
            if field_form.is_valid():
                updated = field_form.save(commit=False)
                updated.owner = request.user if request.user.is_authenticated else None
                updated.save()
                messages.success(request, 'Your field and crop plan have been saved.')
                return redirect('home')
            active_dialog = 'field-dialog'
        elif action == 'event':
            event_form = EventForm(request.POST)
            if event_form.is_valid():
                event = event_form.save(commit=False)
                event.owner = request.user if request.user.is_authenticated else None
                event.save()
                messages.success(request, 'Calendar event added.')
                return redirect(reverse('home') + '#calendar')
            active_dialog = 'event-dialog'
        elif action == 'complete':
            try:
                event_id = int(request.POST.get('event_id', ''))
            except (ValueError, TypeError):
                event_id = None
            farm_events(request).filter(pk=event_id).update(completed=True)
            return redirect(reverse('home') + '#calendar')
    try:
        month_date = date(int(request.GET.get('year', today.year)), int(request.GET.get('month', today.month)), 1)
        if not 2 <= month_date.year <= 9998:
            raise ValueError
    except (ValueError, TypeError):
        month_date = today.replace(day=1)
    previous = (month_date - timedelta(days=1)).replace(day=1)
    following = (month_date.replace(day=28) + timedelta(days=4)).replace(day=1)
    events = farm_events(request).filter(date__year=month_date.year, date__month=month_date.month)
    event_days = set(events.values_list('date__day', flat=True))
    weeks = [[{'day': day, 'today': bool(day and date(month_date.year, month_date.month, day) == today), 'event': day in event_days}
              for day in week] for week in calendar.Calendar(firstweekday=6).monthdayscalendar(month_date.year, month_date.month)]
    harvest = field.planting_date + timedelta(days=field.maturity_days) if field else None
    supported_pin = bool(field and contains_location(field.latitude, field.longitude))
    titles = {'crops':'Your crops & growing plan', 'market':'Your crop market',
              'nasa':'Your land, in numbers', 'alerts':'Current conditions', 'orbee':'Hi! I am Orbee'}
    return render(request, 'website/workspace.html' if workspace_page else 'website/home.html', {
        'workspace_page': workspace_page, 'workspace_title': titles.get(workspace_page),
        'field': field, 'field_form': field_form, 'event_form': event_form,
        'account_contact': FarmerProfile.objects.filter(user=request.user).first() if request.user.is_authenticated else None,
        'month': month_date, 'previous': previous, 'following': following,
        'weeks': weeks, 'events': events, 'harvest': harvest, 'active_dialog': active_dialog,
        'crop_profiles': CropProfile.objects.filter(active=True).values('name'),
        'map_region': map_region(),
        'map_config': {'latitude': float(field.latitude) if supported_pin else None,
                       'longitude': float(field.longitude) if supported_pin else None,
                       'outside_region': bool(field and field.latitude is not None and not supported_pin),
                       'name': field.name if field else 'Your Field'},
    })


@require_GET
@never_cache
def workspace(request, section):
    if section not in {'crops', 'market', 'nasa', 'alerts', 'orbee'}:
        from django.http import Http404
        raise Http404('Workspace page not found')
    return home(request, workspace_page=section)


def dashboard_data(request):
    field = current_field(request)
    return JsonResponse({
        'field': {'name': field.name, 'area_ha': str(field.area) if field.area is not None else None, 'next_crop': field.next_crop,
                  'planting_date': field.planting_date.isoformat(), 'maturity_days': field.maturity_days,
                  'latitude': float(field.latitude) if field.latitude is not None else None,
                  'longitude': float(field.longitude) if field.longitude is not None else None} if field else None,
        'events': list(farm_events(request).values('id', 'title', 'date', 'completed')),
        'environment': {'source': 'NASA POWER', 'endpoint': '/api/weather/', 'history_endpoint': '/api/weather/history/'},
        'crop_recommendations': {'endpoint':'/api/crops/recommendations/','source':'FAO ECOCROP, GAEZ climate and SRTM'},
    })


@require_GET
def weather_data(request):
    # Coordinates come from the saved field, not arbitrary external request URLs.
    field = current_field(request)
    form = AssessmentForm(request.GET)
    if not form.is_valid():
        return JsonResponse({'errors': form.errors}, status=400)
    weather = dict(get_field_weather(field))
    values = form.cleaned_data
    weather['assessment'] = assess_crop(weather, values.get('crop') or (field.next_crop if field else 'Mung Bean'),
                                        values.get('ph'), values.get('drainage') or 'unknown', values.get('water') or 'unknown')
    response = JsonResponse(weather)
    response['Cache-Control'] = 'no-store'
    return response


@require_GET
def market_data(request):
    try:
        return JsonResponse(market_catalogue())
    except (OSError, ValueError, KeyError):
        return JsonResponse({'status':'unavailable','crops':[]}, status=503)


@require_GET
def market_rates(request):
    response = JsonResponse(get_rates())
    response['Cache-Control'] = 'no-store'
    return response


@require_GET
def home_conditions(request):
    field = current_field(request)
    data = get_conditions(field, refresh=True) if request.GET.get('refresh') == '1' else get_conditions(field)
    current = current_field(request)
    if data.get('pin') and (not current or current.latitude is None or current.longitude is None or pin_id(current) != data['pin']):
        return JsonResponse({'status': 'pin_changed'}, status=409)
    remember_orbee('conditions',field,data)
    response = JsonResponse(data)
    response['Cache-Control'] = 'no-store'
    return response


@require_GET
def place_context(request):
    field = current_field(request)
    if not field or field.latitude is None or field.longitude is None:
        return JsonResponse({'status': 'needs_location', 'photo': None})
    latitude, longitude = float(field.latitude), float(field.longitude)
    data = get_place(latitude, longitude)
    current = current_field(request)
    if not current or current.latitude is None or current.longitude is None or pin_id(current) != pin_id(field):
        return JsonResponse({'status': 'pin_changed', 'photo': None}, status=409)
    response = JsonResponse({**data, 'pin': pin_id(field), 'latitude': latitude, 'longitude': longitude})
    response['Cache-Control'] = 'no-store'
    return response


@require_GET
def weather_history(request):
    period = request.GET.get('period', '100d')
    if period not in PERIODS:
        return JsonResponse({'status': 'invalid_period'}, status=400)
    field = current_field(request)
    data = get_history(field, period)
    current = current_field(request)
    if field and field.latitude is not None and field.longitude is not None:
        if not current or current.latitude is None or current.longitude is None or pin_id(current) != pin_id(field):
            return JsonResponse({'status': 'pin_changed'}, status=409)
        data = {**data, 'pin': pin_id(field), 'latitude': float(field.latitude), 'longitude': float(field.longitude)}
    remember_orbee('history',field,data)
    response = JsonResponse(data)
    response['Cache-Control'] = 'no-store'
    return response


@require_GET
def gaez_catalog(request):
    field = current_field(request)
    data = catalogue()
    layers = [{**layer, 'selection': initial_selection(layer, field)} for layer in data['layers']]
    return JsonResponse({'version': data['version'], 'themes': data['themes'], 'defaults': DEFAULTS,
                         'layers': layers, 'planned_crop': field.next_crop if field else '',
                         'has_pin': bool(field and field.latitude is not None and field.longitude is not None)})


@require_GET
def gaez_point(request):
    try:
        layer = request.GET.get('layer', '')
        supplied = {key[4:]: value for key, value in request.GET.items() if key.startswith('dim_')}
        response = JsonResponse(get_point(current_field(request), layer, supplied))
        response['Cache-Control'] = 'no-store'
        return response
    except ValueError as error:
        return JsonResponse({'status': 'invalid_selection', 'message': str(error)}, status=400)


@require_GET
def crop_recommendations(request):
    field=current_field(request)
    data=recommend(field)
    # Discard a response if the saved field changed during external-source reads.
    current=current_field(request)
    if data.get('pin') and (not current or current.latitude is None or pin_id(current)!=data['pin']):
        return JsonResponse({'status':'pin_changed'},status=409)
    remember_orbee('crops',field,data)
    response=JsonResponse(data);response['Cache-Control']='no-store'
    return response


@require_GET
def crop_gaez(request):
    field=current_field(request)
    if not field or field.latitude is None or field.longitude is None:
        return JsonResponse({'status':'needs_location'})
    if request.GET.get('pin')!=pin_id(field):return JsonResponse({'status':'pin_changed'},status=409)
    profile=CropProfile.objects.filter(slug=request.GET.get('crop',''),active=True).first()
    if not profile:return JsonResponse({'status':'unknown_crop'},status=400)
    if not profile.gaez_code:
        return JsonResponse({'status':'not_available','message':'No matching crop in the linked GAEZ layer. No substitute species was used.'})
    data=get_point(field,'RES05-SXX30AS',{'PERIOD':'HP0120','CLIM':'AGERA5','SSP':'HIST',
                                       'CROP-RES05':profile.gaez_code,'WSIM-RES05':'LRLM'})
    data.update(crop=profile.slug,scope='Independent GAEZ regional model context, rain-fed low inputs. This is not the TerraGrow range-screen score.',
                crop_notes=profile.notes)
    response=JsonResponse(data);response['Cache-Control']='no-store'
    return response


@require_GET
def copernicus_data(request):
    kind = request.GET.get('kind', 'catalogue')
    if kind not in ('catalogue', 'vegetation'):
        return JsonResponse({'status': 'invalid_request'}, status=400)
    field = current_field(request)
    data = catalogue_at_pin(field) if kind == 'catalogue' else vegetation_at_pin(field)
    if kind=='vegetation':remember_orbee('vegetation',field,data)
    response = JsonResponse(data)
    response['Cache-Control'] = 'no-store'
    return response


@require_GET
def copernicus_image(request):
    try:
        image = vegetation_image(current_field(request), request.GET.get('pin', ''), request.GET.get('date', ''))
        response = HttpResponse(image, content_type='image/png')
    except CopernicusError as error:
        response = JsonResponse({'status': error.status}, status=409 if error.status == 'pin_changed' else 400 if error.status in ('invalid_observation', 'needs_location') else 503)
    response['Cache-Control'] = 'no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response
