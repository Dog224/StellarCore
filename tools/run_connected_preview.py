"""Run a real credential-enabled launcher for QA with explicitly mocked authentication."""
import os
import socket
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('DJANGO_SETTINGS_MODULE','stellas.settings')
from django.conf import settings

with tempfile.TemporaryDirectory(prefix='mekongrise-connected-db-') as directory:
    settings.DATABASES['default']['NAME']=str(Path(directory)/'test.sqlite3')
    settings.DEBUG=True
    settings.ANTHROPIC_API_KEY='qa-only-not-a-real-key'
    import django
    django.setup()
    from django.core.management import call_command
    from website.orbee_ai import OrbeeError
    call_command('migrate',verbosity=0)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
    print('SIMULATED AUTHENTICATION FOR QA; no paid Claude calls.',flush=True)
    print(f'AUTH_PREVIEW_URL=http://127.0.0.1:{port}',flush=True)
    # Real run_orbee handler/server; only external credential verification is mocked.
    with patch('website.management.commands.run_orbee.verify_access'),patch('website.orbee_ai._request',side_effect=OrbeeError('unavailable')):
        call_command('run_orbee',f'127.0.0.1:{port}',use_reloader=False,verbosity=0)
