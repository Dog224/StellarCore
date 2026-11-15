from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory

from django.conf import settings
from django.template import engines, TemplateDoesNotExist
from django.test import SimpleTestCase, override_settings


class DevelopmentTemplateTests(SimpleTestCase):
    def test_running_development_backend_reads_edited_and_new_templates(self):
        # Exercise repeated rendering in one process, like run_orbee without
        # auto-reload. Refresh must not keep the old HTML or a cached miss.
        with TemporaryDirectory() as directory:
            templates = deepcopy(settings.TEMPLATES)
            templates[0]['DIRS'] = [directory]
            with override_settings(TEMPLATES=templates):
                backend = engines['django']
                path = Path(directory, 'local-edit-check.html')
                with self.assertRaises(TemplateDoesNotExist):
                    backend.get_template(path.name)
                path.write_text('Before the edit', encoding='utf-8')
                self.assertEqual(backend.get_template(path.name).render(), 'Before the edit')
                path.write_text('Updated photo layout', encoding='utf-8')
                self.assertEqual(backend.get_template(path.name).render(), 'Updated photo layout')
