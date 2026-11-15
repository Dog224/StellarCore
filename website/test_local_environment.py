import io
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.management import call_command
from django.test import SimpleTestCase, override_settings

from stellas.environment import load_local_environment


class LocalEnvironmentTests(SimpleTestCase):
    def test_saved_configuration_loads_on_every_new_server_environment(self):
        with TemporaryDirectory() as directory:
            Path(directory, '.env').write_text(
                '# Private local settings\nANTHROPIC_API_KEY="test-only-saved-key"\n',
                encoding='utf-8-sig')
            for _ in range(2):
                with patch.dict(os.environ, {}, clear=True):
                    load_local_environment(directory)
                    self.assertEqual(os.environ['ANTHROPIC_API_KEY'], 'test-only-saved-key')

    def test_server_environment_takes_precedence_and_secrets_are_literal(self):
        with TemporaryDirectory() as directory:
            Path(directory, '.env').write_text(
                'ANTHROPIC_API_KEY=file-key\nANTHROPIC_WORKSPACE_ID=${PRIVATE_VALUE}\n',
                encoding='utf-8')
            with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'deployment-key',
                                         'PRIVATE_VALUE': 'do-not-expand'}, clear=True):
                load_local_environment(directory)
                self.assertEqual(os.environ['ANTHROPIC_API_KEY'], 'deployment-key')
                self.assertEqual(os.environ['ANTHROPIC_WORKSPACE_ID'], '${PRIVATE_VALUE}')

    def test_missing_file_does_not_search_parent_directories(self):
        with TemporaryDirectory() as directory:
            Path(directory, '.env').write_text('ANTHROPIC_API_KEY=unrelated-key\n', encoding='utf-8')
            project = Path(directory, 'project')
            project.mkdir()
            with patch.dict(os.environ, {}, clear=True):
                load_local_environment(project)
                self.assertNotIn('ANTHROPIC_API_KEY', os.environ)

    @override_settings(ANTHROPIC_API_KEY='test-only-saved-key')
    @patch('website.management.commands.run_orbee.getpass.getpass')
    @patch('website.management.commands.run_orbee.verify_access')
    @patch('django.contrib.staticfiles.management.commands.runserver.Command.handle')
    def test_configured_key_starts_without_prompt_and_is_never_printed(self, run, verify, prompt):
        output = io.StringIO()
        run.return_value = None
        call_command('run_orbee', '127.0.0.1:0', stdout=output)
        prompt.assert_not_called()
        verify.assert_called_once_with()
        run.assert_called_once()
        self.assertNotIn('test-only-saved-key', output.getvalue())

    def test_private_file_is_not_served_by_django(self):
        self.assertEqual(self.client.get('/.env').status_code, 404)
