"""Start a local server with Copernicus credentials held only in memory."""
import getpass
from django.conf import settings
from django.core.management.base import CommandError
from website.development_server import RunserverCommand
from website.copernicus import access_token, CopernicusError


class Command(RunserverCommand):
    help = 'Connect a Sentinel Hub OAuth client, verify access, and run Django locally. Secrets are not saved to files.'

    def handle(self, *args, **options):
        self.stdout.write('Use a Copernicus Sentinel Hub OAuth client from https://shapps.dataspace.copernicus.eu/ .')
        client_id = settings.COPERNICUS_CLIENT_ID or input('Copernicus client ID: ').strip()
        secret = settings.COPERNICUS_CLIENT_SECRET or getpass.getpass('Copernicus client secret (hidden): ').strip()
        if not client_id or not secret: raise CommandError('Both values are required. No credentials were saved.')
        settings.COPERNICUS_CLIENT_ID, settings.COPERNICUS_CLIENT_SECRET = client_id, secret
        try: access_token()
        except CopernicusError as error:
            raise CommandError('Copernicus connection could not be verified: ' + error.status + '. Check your client and network; no credentials were saved.') from None
        self.stdout.write(self.style.SUCCESS('Copernicus token verified. Vegetation processing is enabled for this server session.'))
        # No reloader subprocess is needed, and secrets never become command-line arguments.
        options['use_reloader'] = False
        try: return super().handle(*args, **options)
        finally:
            settings.COPERNICUS_CLIENT_ID = settings.COPERNICUS_CLIENT_SECRET = ''
