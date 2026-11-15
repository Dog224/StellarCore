"""Exercise the actual custom launchers' handlers, not the test client's app handler."""
from django.conf import settings
from django.test import SimpleTestCase, RequestFactory, override_settings

from .management.commands.run_orbee import Command as OrbeeCommand
from .management.commands.run_copernicus import Command as CopernicusCommand


@override_settings(DEBUG=True)
class ConnectedServerStaticTests(SimpleTestCase):
    def request(self,handler,path):
        captured={}
        def start_response(status,headers):
            captured.update(status=status,headers=dict(headers))
        response=handler(RequestFactory().get(path).environ,start_response)
        try:body=b''.join(response)
        finally:
            if hasattr(response,'close'):response.close()
        return captured,body

    def handler(self,command,**extra):
        parser=command.create_parser('manage.py','preview')
        options=vars(parser.parse_args([]))
        return command.get_handler(**{**options,**extra})

    def test_both_secret_prompt_launchers_serve_css_js_icons_fonts_and_mascot(self):
        assets={'style.css':('text/css',b'--forest'),
                'workspace.css':('text/css',b'.nasa-overview-grid'),
                'orbee.css':('text/css',b'.orbee-chat'),
                'theme.js':('javascript',b'mekongrise-theme'),
                'workspace-mount.js':('javascript',b'workspace-content'),
                'weather-history.js':('javascript',b'weather-history'),
                'orbee.js':('javascript',b'checkConnection'),
                'icons.svg':('image/svg+xml',b'<svg'),
                'fonts/NotoSansLao-Variable.ttf':('font',b'\x00\x01\x00\x00'),
                'orbee/orbee-poses.webp':('image/webp',b'RIFF')}
        for command in (OrbeeCommand(),CopernicusCommand()):
            handler=self.handler(command)
            for name,(mime,marker) in assets.items():
                with self.subTest(command=command.__class__.__module__,asset=name):
                    response,body=self.request(handler,'/static/website/'+name)
                    self.assertEqual(response['status'].split()[0],'200')
                    content_type=response['headers']['Content-Type']
                    self.assertNotIn('text/html',content_type)
                    self.assertIn(mime,content_type)
                    self.assertIn(marker,body)

    def test_static_server_does_not_expose_files_outside_the_asset_tree(self):
        for command in (OrbeeCommand(),CopernicusCommand()):
            handler=self.handler(command)
            from django.core.exceptions import SuspiciousFileOperation
            for path in ['/static/website/../../db.sqlite3','/static/../.secret_key']:
                with self.assertRaises(SuspiciousFileOperation):self.request(handler,path)
            response,_=self.request(handler,'/static/website/missing.css')
            self.assertEqual(response['status'].split()[0],'404')

    def test_production_and_explicit_nostatic_keep_normal_django_behavior(self):
        from django.contrib.staticfiles.handlers import StaticFilesHandler
        for command in (OrbeeCommand(),CopernicusCommand()):
            self.assertNotIsInstance(self.handler(command,use_static_handler=False),StaticFilesHandler)
            with override_settings(DEBUG=False):
                self.assertNotIsInstance(self.handler(command),StaticFilesHandler)

    def test_development_styles_and_scripts_are_not_cached_by_browsers(self):
        for command in (OrbeeCommand(), CopernicusCommand()):
            for name in ('theme.css', 'style.css', 'theme.js', 'weather-history.js'):
                response, _ = self.request(self.handler(command), '/static/website/' + name)
                self.assertEqual(response['status'].split()[0], '200')
                self.assertIn('no-store', response['headers']['Cache-Control'])
                self.assertIn('must-revalidate', response['headers']['Cache-Control'])
