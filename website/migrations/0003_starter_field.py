from datetime import timedelta
from django.db import migrations
from django.utils import timezone


def create_starter_field(apps, schema_editor):
    Field = apps.get_model('website', 'Field')
    if not Field.objects.exists():
        Field.objects.create(name='Your Field', area='5.20', previous_crop='Rice',
                             next_crop='Mung Bean', following_crop='Maize',
                             planting_date=timezone.localdate() + timedelta(days=14), maturity_days=75)


class Migration(migrations.Migration):
    dependencies = [('website', '0002_farmevent_field')]
    operations = [migrations.RunPython(create_starter_field, migrations.RunPython.noop)]
