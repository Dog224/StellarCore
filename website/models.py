from django.db import models
from django.core.validators import MinValueValidator, MaxValueValidator
from django.conf import settings


class FarmerProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='farmer_profile')
    phone = models.CharField(max_length=16, unique=True, null=True, blank=True)

    def __str__(self):
        return self.user.email or self.phone or 'Farmer'


class ContactMessage(models.Model):
    name = models.CharField(max_length=100)
    email = models.EmailField()
    message = models.TextField(max_length=3000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} — {self.email}'


class Field(models.Model):
    owner = models.OneToOneField(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name='farm_field')
    latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True, validators=[MinValueValidator(-90), MaxValueValidator(90)])
    longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True, validators=[MinValueValidator(-180), MaxValueValidator(180)])
    name = models.CharField(max_length=100, default='Your Field')
    area = models.DecimalField(max_digits=8, decimal_places=2, default=5.2, null=True, blank=True, validators=[MinValueValidator(0.01)])
    previous_crop = models.CharField(max_length=80, default='Rice')
    next_crop = models.CharField(max_length=80, default='Mung Bean')
    following_crop = models.CharField(max_length=80, default='Maize')
    planting_date = models.DateField()
    maturity_days = models.PositiveIntegerField(default=75, validators=[MinValueValidator(1), MaxValueValidator(730)])

    def __str__(self):
        return self.name


class FarmEvent(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name='farm_events')
    title = models.CharField(max_length=120)
    date = models.DateField()
    completed = models.BooleanField(default=False)

    class Meta:
        ordering = ['date', 'id']

    def __str__(self):
        return self.title


class CropProfile(models.Model):
    """Versioned FAO descriptors; null means unreported, never an invented bound."""
    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=100)
    scientific_name = models.CharField(max_length=150)
    category = models.CharField(max_length=30)
    life_cycle = models.CharField(max_length=40)
    requirements = models.JSONField()
    growing_days = models.JSONField(default=list)
    first_harvest_days = models.JSONField(null=True)
    water = models.JSONField(default=dict)
    image_path = models.CharField(max_length=150)
    gaez_code = models.CharField(max_length=20, null=True)
    gaez_potential_code = models.CharField(max_length=20, null=True)
    notes = models.JSONField(default=list)
    source = models.JSONField(default=dict)
    reference_version = models.CharField(max_length=50)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name
