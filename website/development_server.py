"""Keep development CSS and scripts fresh across ordinary page reloads."""
from django.conf import settings
from django.contrib.staticfiles.handlers import StaticFilesHandler
from django.contrib.staticfiles.management.commands.runserver import Command as StaticRunserverCommand
from django.utils.cache import add_never_cache_headers


class FreshStaticFilesHandler(StaticFilesHandler):
    def serve(self, request):
        response = super().serve(request)
        if request.path.endswith(('.css', '.js')):
            add_never_cache_headers(response)
        return response


class RunserverCommand(StaticRunserverCommand):
    def get_handler(self, *args, **options):
        handler = super().get_handler(*args, **options)
        if settings.DEBUG and isinstance(handler, StaticFilesHandler):
            return FreshStaticFilesHandler(handler.application)
        return handler
