"""Canonical contact identifiers; validation is not SMS ownership verification."""
import re
import phonenumbers


def normalize_phone(value):
    value = str(value or '').strip()
    if not value or not re.fullmatch(r'[+\d\s().-]+', value):
        raise ValueError('Enter a valid phone number.')
    try:
        number = phonenumbers.parse(value, 'LA')
    except phonenumbers.NumberParseException as error:
        raise ValueError('Enter a valid phone number.') from error
    if number.extension or not phonenumbers.is_valid_number(number):
        raise ValueError('Enter a valid phone number.')
    return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)
