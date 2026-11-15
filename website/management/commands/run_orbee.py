"""Use configured credentials or a private prompt to enable Claude for Orbee."""
import getpass
import socket
from django.conf import settings
from django.core.management.base import CommandError
from website.development_server import RunserverCommand
from website.orbee_ai import verify_access, OrbeeError


class Command(RunserverCommand):
    help = 'Run Claude-powered Orbee using the server environment or .env; prompt privately if no key is configured.'

    def add_arguments(self,parser):
        super().add_arguments(parser)
        parser.add_argument('--model',help='An accessible Claude model ID; defaults to ORBEE_MODEL.')

    def handle(self,*args,**options):
        # A previously running plain server can make a successful key check look
        # connected even though the old server still owns the website's port.
        address=options.get('addrport') or '127.0.0.1:8000'
        host,separator,port=address.rpartition(':')
        if not separator:host,port='127.0.0.1',address
        host=host.strip('[]')
        if host in ('127.0.0.1','localhost','0.0.0.0','::1','::') and port.isdigit() and 0<int(port)<65536:
            try:
                with socket.socket(socket.AF_INET6 if ':' in host or options.get('use_ipv6') else socket.AF_INET,socket.SOCK_STREAM) as probe:
                    probe.bind((host,int(port)))
            except OSError:
                raise CommandError('Port '+port+' is already in use or unavailable. Stop the Django server currently serving this port with Ctrl+C, then run this command again. Claude has not been started on this port.') from None
        key=settings.ANTHROPIC_API_KEY or getpass.getpass('Anthropic API key (hidden; not saved): ').strip()
        if not key:raise CommandError('An Anthropic API key is required. Set ANTHROPIC_API_KEY in the private .env file or enter it at the prompt.')
        previous_key,previous_model=settings.ANTHROPIC_API_KEY,settings.ORBEE_MODEL
        settings.ANTHROPIC_API_KEY=key
        settings.ORBEE_MODEL=options.pop('model') or settings.ORBEE_MODEL
        options['use_reloader']=False
        try:
            verify_access()
            self.stdout.write(self.style.SUCCESS('Claude model access verified. Starting the Orbee-enabled server now; keep this terminal running.'))
            return super().handle(*args,**options)
        except OrbeeError as error:
            raise CommandError('Claude access could not be verified: '+error.status+'. Check the configured key, model and API account. This command did not change your saved settings.') from None
        finally:
            settings.ANTHROPIC_API_KEY,settings.ORBEE_MODEL=previous_key,previous_model
