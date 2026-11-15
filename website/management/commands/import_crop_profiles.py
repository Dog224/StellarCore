import json
from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction
from website.models import CropProfile


class Command(BaseCommand):
    help = 'Import the bundled, sourced FAO crop references (no network access).'

    @transaction.atomic
    def handle(self, *args, **options):
        data=json.loads((settings.BASE_DIR/'website/data/crops_ecocrop_v1.json').read_text(encoding='utf8'))
        for item in data['crops']:
            CropProfile.objects.update_or_create(slug=item['slug'],defaults={**item,'reference_version':data['version']})
        self.stdout.write(f'Imported {len(data["crops"])} sourced crop profiles.')
