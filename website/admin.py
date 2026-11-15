from django.contrib import admin
from .models import ContactMessage, Field, FarmEvent, CropProfile

admin.site.register(Field)
admin.site.register(FarmEvent)


@admin.register(CropProfile)
class CropProfileAdmin(admin.ModelAdmin):
    list_display = ['name', 'scientific_name', 'category', 'reference_version', 'active']
    search_fields = ['name', 'scientific_name']
    list_filter = ['category', 'active']
    readonly_fields = ['source', 'requirements', 'water', 'reference_version']

    def has_add_permission(self, request):
        # Reference facts enter through the reviewed FAO import, not an incomplete
        # free-form admin record that could silently omit its provenance.
        return False


@admin.register(ContactMessage)
class ContactMessageAdmin(admin.ModelAdmin):
    list_display = ['name', 'email', 'created_at']
    search_fields = ['name', 'email', 'message']
    readonly_fields = ['created_at']
