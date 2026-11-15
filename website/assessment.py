"""Transparent screening of a few crop factors, not a soil-health diagnosis."""
from datetime import date
from django.utils import timezone

from django.db.models import Q
from .models import CropProfile


def assess_crop(weather, crop, ph=None, drainage='unknown', water='unknown'):
    result = {'crop': crop, 'soil_health': 'Not determined', 'status': 'needs_checks',
              'title': 'More field checks needed', 'checks': [], 'sources': [],
              'limitations': 'Regional estimates cannot confirm the health of this exact field. Test soil pH, nutrients, salinity and organic matter, and inspect drainage. This is a preliminary screen, not a planting forecast or a yield prediction.'}
    key = crop.strip().lower()
    key = {'corn': 'maize', 'mungbean': 'mung bean', 'ຖົ່ວຂຽວ': 'mung bean', 'ถั่วเขียว': 'mung bean',
           'ເຂົ້າ': 'rice', 'ข้าว': 'rice', 'ສາລີ': 'maize', 'ข้าวโพด': 'maize'}.get(key, key)
    record = CropProfile.objects.filter(Q(name__iexact=key) | Q(slug__iexact=key.replace(' ', '-')), active=True).first()
    profile = None if record is None else {'name':record.name, 'temperature':record.requirements['temperature_c']['optimal'],
        'ph':record.requirements['ph']['optimal'], 'paddy':record.slug=='rice',
        'sources':[(f"FAO ECOCROP: {record.name}", record.source['url'])]}
    if not profile:
        result.update(status='unsupported', title='Crop profile not available')
        return result
    result['crop'] = profile['name']
    result['sources'] = [{'title': name, 'url': url} for name, url in profile['sources']]
    if weather.get('status') != 'ok':
        result.update(status='unavailable', title='Save a pin and load weather first')
        return result
    try:
        age = (timezone.localdate() - date.fromisoformat(weather['period_end'])).days
    except (KeyError, ValueError):
        age = 999
    if age > 14 or age < 0:
        result.update(status='stale', title='Recent conditions are unavailable')
        return result
    checks = result['checks']
    low, high = profile['temperature']
    temperature = weather['temperature_c']
    checks.append({'label': 'Recent air temperature', 'state': 'match' if low <= temperature <= high else 'review',
                   'detail': f'{temperature:.1f} °C; crop reference {low}–{high} °C. A weekly air average does not establish sowing soil temperature or growing-season suitability.'})
    low, high = profile['ph']
    checks.append({'label': 'Measured soil pH', 'state': 'unknown' if ph is None else 'match' if low <= ph <= high else 'review',
                   'detail': f'Crop reference pH {low}–{high}. ' + ('Enter a local soil-test result.' if ph is None else f'Your entered value: {ph}. Confirm the test applies to this pin.')})
    if profile['paddy']:
        checks.append({'label': 'Rice water management', 'state': 'match' if water == 'yes' else 'unknown',
                       'detail': 'Lowland rice needs planned water control. Confirm the rice system, variety and reliable water supply on site.'})
    else:
        checks.append({'label': 'Field drainage', 'state': {'well': 'match', 'poor': 'review'}.get(drainage, 'unknown'),
                       'detail': 'Drainage is your field observation, not inferred from satellite wetness. Consult the sourced crop requirements and inspect the field.'})
    soil = weather.get('soil_moisture') or {}
    checks.append({'label': 'Soil moisture context', 'state': 'context' if soil.get('status') == 'ok' else 'unknown',
                   'detail': 'A regional wetness value cannot establish plant-available water without soil texture, field capacity and wilting point.'})
    checks.append({'label': 'Recent rainfall context', 'state': 'context',
                   'detail': 'Review the displayed rainfall period and irrigation supply. Seven days of rain cannot establish seasonal crop water suitability.'})
    if any(check['state'] == 'review' for check in checks):
        result.update(status='review', title='Potential constraints — review before planting')
    elif not any(check['state'] == 'unknown' for check in checks):
        result.update(status='possible', title='Potential match on checked factors')
    return result
