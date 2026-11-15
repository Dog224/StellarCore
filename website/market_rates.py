"""Dated USD/LAK/THB reference conversion; no hardcoded exchange rates."""
import json
import math
from datetime import date, timedelta
from pathlib import Path
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.cache.backends.filebased import FileBasedCache
from django.utils import timezone

ENDPOINT = 'https://api.frankfurter.dev/v2/rates?base=USD&quotes=LAK,THB&expand=providers'
SOURCE = 'https://frankfurter.dev/'
cache = FileBasedCache(str(settings.BASE_DIR / '.market_cache'), {'TIMEOUT':21600,'OPTIONS':{'MAX_ENTRIES':30}})


def parse_rates(payload):
    if not isinstance(payload,list):
        raise ValueError('Unexpected currency response')
    rates, dates, providers = {'USD':1.0}, {}, {}
    today = timezone.localdate()
    for row in payload:
        quote = row.get('quote')
        value = row.get('rate')
        if quote not in ('LAK','THB') or row.get('base') != 'USD' or quote in dates:
            raise ValueError('Unexpected or duplicate currency')
        if isinstance(value,bool) or not isinstance(value,(float,int)) or not math.isfinite(value) or value <= 0:
            raise ValueError('Invalid conversion rate')
        day = date.fromisoformat(row['date'])
        if day > today+timedelta(days=1) or today-day > timedelta(days=7):
            raise ValueError('Exchange rates outside the accepted date range')
        rates[quote], dates[quote] = float(value), day.isoformat()
        providers[quote] = [{'key':p.get('key'), 'date':p.get('date')} for p in row.get('providers',[]) if not p.get('excluded')]
    if set(dates) != {'LAK','THB'}:
        raise ValueError('Both LAK and THB rates are required')
    return {'status':'ok', 'base':'USD', 'rates':rates, 'dates':dates, 'providers':providers,
            'fetched_at':timezone.now().isoformat(), 'source':'Frankfurter blended reference rates',
            'source_url':SOURCE, 'endpoint':ENDPOINT,
            'note':'Reference conversion only. Bank, cash and transfer rates may differ.'}


def get_rates():
    saved = cache.get('fx-v1')
    if saved:
        return saved
    try:
        with urlopen(Request(ENDPOINT,headers={'User-Agent':'MekongRise/1.0 market currency display'}),timeout=8) as response:
            content=response.read(100001)
        if len(content)>100000:
            raise ValueError('Currency response too large')
        data=parse_rates(json.loads(content))
        cache.set('fx-v1-last-good',data,7*86400)
        cache.set('fx-v1',data,21600)
        return data
    except (OSError,ValueError,TypeError,KeyError,AttributeError):
        previous=cache.get('fx-v1-last-good')
        if not previous:
            try:
                previous=json.loads((Path(settings.BASE_DIR)/'website/data/market_fx_snapshot.json').read_text(encoding='utf-8'))
            except (OSError,ValueError):
                previous=None
        valid=False
        if previous:
            try:
                parse_rates([{'base':'USD','quote':quote,'date':previous['dates'][quote],'rate':previous['rates'][quote]} for quote in ('LAK','THB')])
                valid=True
            except (ValueError,TypeError,KeyError,AttributeError):
                pass
        result={**previous,'status':'stale'} if valid else {'status':'unavailable','source_url':SOURCE,'rates':{}}
        cache.set('fx-v1',result,120)
        return result
