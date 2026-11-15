"""Isolated browser-QA server. Never connects to the user's farm database."""
import os
import socket
import tempfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'stellas.settings')

from django.conf import settings

with tempfile.TemporaryDirectory(prefix='mekongrise-auth-db-') as directory:
    settings.DATABASES['default']['NAME'] = str(Path(directory) / 'test.sqlite3')
    import django
    django.setup()
    from django.core.management import call_command
    call_command('migrate', verbosity=0)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    print(f'AUTH_PREVIEW_URL=http://127.0.0.1:{port}', flush=True)
    call_command('runserver', f'127.0.0.1:{port}', use_reloader=False, verbosity=0)
