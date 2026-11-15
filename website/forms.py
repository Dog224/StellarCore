from django import forms
from datetime import date
from .models import ContactMessage, Field, FarmEvent
from .region import contains_location, REGION_MESSAGE


class ContactForm(forms.ModelForm):
    class Meta:
        model = ContactMessage
        fields = ['name', 'email', 'message']
        widgets = {
            'name': forms.TextInput(attrs={'placeholder': 'Your name', 'autocomplete': 'name'}),
            'email': forms.EmailInput(attrs={'placeholder': 'you@example.com', 'autocomplete': 'email'}),
            'message': forms.Textarea(attrs={'placeholder': 'Tell us what you have in mind…', 'rows': 5}),
        }


class FieldForm(forms.ModelForm):
    def clean_planting_date(self):
        value = self.cleaned_data['planting_date']
        if value > date(9997, 12, 31):
            raise forms.ValidationError('Please choose a planting date before the year 9998.')
        return value

    class Meta:
        model = Field
        fields = ['name', 'area', 'previous_crop', 'next_crop', 'following_crop', 'planting_date', 'maturity_days']
        widgets = {'planting_date': forms.DateInput(attrs={'type': 'date'}, format='%Y-%m-%d')}


class EventForm(forms.ModelForm):
    class Meta:
        model = FarmEvent
        fields = ['title', 'date']
        widgets = {'date': forms.DateInput(attrs={'type': 'date'})}


class LocationForm(forms.Form):
    latitude = forms.DecimalField(min_value=-90, max_value=90, max_digits=10, decimal_places=7)
    longitude = forms.DecimalField(min_value=-180, max_value=180, max_digits=10, decimal_places=7)

    def clean(self):
        values = super().clean()
        if 'latitude' in values and 'longitude' in values and not contains_location(values['latitude'], values['longitude']):
            raise forms.ValidationError(REGION_MESSAGE)
        return values


class AssessmentForm(forms.Form):
    crop = forms.CharField(max_length=80, required=False)
    ph = forms.DecimalField(min_value=0, max_value=14, required=False, max_digits=4, decimal_places=2)
    drainage = forms.ChoiceField(choices=[('unknown', 'Unknown'), ('well', 'Well drained'), ('poor', 'Poorly drained')], required=False)
    water = forms.ChoiceField(choices=[('unknown', 'Unknown'), ('yes', 'Planned water control'), ('no', 'No water control')], required=False)
