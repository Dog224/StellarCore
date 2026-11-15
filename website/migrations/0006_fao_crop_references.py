import json
from pathlib import Path
from django.db import migrations


def seed(apps, schema_editor):
    CropProfile = apps.get_model('website', 'CropProfile')
    data = json.loads((Path(__file__).resolve().parents[1] / 'data/crops_ecocrop_v1.json').read_text(encoding='utf8'))
    for item in data['crops']:
        CropProfile.objects.using(schema_editor.connection.alias).update_or_create(
            slug=item['slug'], defaults={**item, 'reference_version': data['version']})


class Migration(migrations.Migration):
    dependencies = [('website', '0005_cropprofile')]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
