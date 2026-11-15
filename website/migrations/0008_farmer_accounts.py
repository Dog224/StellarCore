from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('website', '0007_crop_photographs'), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.AddField(model_name='field', name='owner', field=models.OneToOneField(
            blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='farm_field', to=settings.AUTH_USER_MODEL)),
        migrations.AddField(model_name='farmevent', name='owner', field=models.ForeignKey(
            blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='farm_events', to=settings.AUTH_USER_MODEL)),
    ]
