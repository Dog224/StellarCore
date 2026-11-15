from django.db import migrations, models
import django.core.validators


class Migration(migrations.Migration):
    dependencies = [('website', '0008_farmer_accounts')]
    operations = [migrations.AlterField(model_name='field', name='area', field=models.DecimalField(
        blank=True, null=True, decimal_places=2, max_digits=8, default=5.2,
        validators=[django.core.validators.MinValueValidator(0.01)]))]
