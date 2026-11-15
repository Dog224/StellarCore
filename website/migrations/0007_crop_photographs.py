"""Replace bundled illustrations without changing crop requirements or scores."""
from django.db import migrations

SLUGS = ('rice', 'maize', 'cassava', 'arabica-coffee', 'robusta-coffee', 'banana',
         'peanut', 'soybean', 'mung-bean', 'tomato', 'cabbage', 'cucumber', 'chilli')


def swap(apps, schema_editor, before, after):
    CropProfile = apps.get_model('website', 'CropProfile')
    for slug in SLUGS:
        CropProfile.objects.using(schema_editor.connection.alias).filter(
            slug=slug, image_path=f'website/crops/{slug}.{before}'
        ).update(image_path=f'website/crops/{slug}.{after}')


def forwards(apps, schema_editor):
    swap(apps, schema_editor, 'svg', 'jpg')


def backwards(apps, schema_editor):
    swap(apps, schema_editor, 'jpg', 'svg')


class Migration(migrations.Migration):
    dependencies = [('website', '0006_fao_crop_references')]
    operations = [migrations.RunPython(forwards, backwards)]
