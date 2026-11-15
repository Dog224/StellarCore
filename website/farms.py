"""Separate authenticated farmers' saved data from the existing public workspace."""
from django.utils import timezone
from .models import Field, FarmEvent


def current_field(request):
    if request.user.is_authenticated:
        field, _ = Field.objects.get_or_create(owner=request.user, defaults={'planting_date': timezone.localdate(), 'area': None})
        return field
    return Field.objects.filter(owner__isnull=True).first()


def farm_events(request):
    return FarmEvent.objects.filter(owner=request.user if request.user.is_authenticated else None)
