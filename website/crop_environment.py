"""Independent, coordinate-keyed climate normals and terrain; no sample fallback."""
import calendar
import hashlib
import json
import math
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from django.conf import settings
from django.core.cache.backends.filebased import FileBasedCache
from django.utils import timezone
from .gaez import get_point

cache = FileBasedCache(str(settings.BASE_DIR / '.crop_cache'), {'TIMEOUT': 86400, 'OPTIONS': {'MAX_ENTRIES': 1000}})
POWER = 'https://power.larc.nasa.gov/api/temporal/climatology/point'
TOPO = 'https://api.opentopodata.org/v1/srtm90m'
MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']


def pin_id(field):
    return hashlib.sha256(f'{float(field.latitude):.7f},{float(field.longitude):.7f}'.encode()).hexdigest()[:24]


def read_json(url):
    with urlopen(Request(url, headers={'User-Agent':'TerraGrow sourced crop screening'}), timeout=12) as response:
        raw=response.read(1_000_001)
        if len(raw)>1_000_000: raise ValueError('Source response exceeded limit')
        result=json.loads(raw)
        if not isinstance(result,dict):raise ValueError('Invalid source response')
        return result


def finite(value):
    return isinstance(value,(float,int)) and not isinstance(value,bool) and math.isfinite(value)


def climate(field):
    url=POWER+'?'+urlencode({'parameters':'T2M,PRECTOTCORR','community':'AG','latitude':float(field.latitude),
                            'longitude':float(field.longitude),'format':'JSON'})
    base={'source':'NASA POWER / MERRA-2 climate normals','source_url':url,
          'resolution':'Regional climate grid; nearby pins may share the same values.',
          'retrieved_at':timezone.now().isoformat(),'dataset_period':None}
    key='climate-v1-'+pin_id(field)
    existing=cache.get(key)
    if existing is not None:return existing
    try:
        raw=read_json(url)
        if raw['parameters']['T2M']['units']!='C' or raw['parameters']['PRECTOTCORR']['units']!='mm/day':
            raise ValueError('Unexpected NASA units')
        values=raw['properties']['parameter'];missing=raw['header'].get('fill_value',-999)
        months=[]
        for index,name in enumerate(MONTHS,1):
            temp,rain=values['T2M'].get(name),values['PRECTOTCORR'].get(name)
            if not all(finite(v) and v!=missing for v in (temp,rain)) or rain<0:
                raise ValueError('Incomplete climate normals')
            # Gregorian average February; rain is a daily rate, not a monthly sum.
            days=28.2425 if index==2 else calendar.monthrange(2001,index)[1]
            months.append({'month':index,'temperature_c':temp,'rainfall_mm':round(rain*days,2)})
        annual_temp=values['T2M'].get('ANN')
        if not finite(annual_temp) or annual_temp==missing:raise ValueError('Missing annual temperature')
        result={**base,'status':'ok','dataset_period':raw['header'].get('range'),
                'temperature_c':annual_temp,'annual_rainfall_mm':round(sum(m['rainfall_mm'] for m in months),1),
                'months':months,'api_version':raw['header'].get('api',{}).get('version'),
                'conversion':'Monthly mean daily precipitation × average Gregorian month length; summed over 12 months.'}
    except (OSError,ValueError,KeyError,TypeError):result={**base,'status':'unavailable','message':'Climate normals could not be retrieved. No example climate was substituted.'}
    cache.set(key,result,86400 if result['status']=='ok' else 120)
    return result


def elevation(field):
    url=TOPO+'?'+urlencode({'locations':f'{float(field.latitude):.7f},{float(field.longitude):.7f}'})
    base={'source':'NASA/USGS SRTM v3 via Open Topo Data','source_url':url,'dataset_period':'SRTM mission, February 2000',
          'resolution':'~90 m terrain grid','retrieved_at':timezone.now().isoformat()}
    key='elevation-v1-'+pin_id(field)
    existing=cache.get(key)
    if existing is not None:return existing
    try:
        raw=read_json(url);record=raw['results'][0];value=record.get('elevation')
        if raw.get('status')!='OK' or record.get('dataset')!='srtm90m' or not finite(value):raise ValueError('Missing elevation')
        location=record.get('location',{})
        if abs(location.get('lat',999)-float(field.latitude))>.001 or abs(location.get('lng',999)-float(field.longitude))>.001:raise ValueError('Wrong elevation point')
        result={**base,'status':'ok','elevation_m':value}
    except (OSError,ValueError,KeyError,TypeError,IndexError):result={**base,'status':'unavailable','elevation_m':None}
    cache.set(key,result,2592000 if result['status']=='ok' else 120)
    return result


def get_environment(field):
    if not field or field.latitude is None or field.longitude is None:return {'status':'needs_location'}
    if not -90<=float(field.latitude)<=90 or not -180<=float(field.longitude)<=180:raise ValueError('Invalid saved pin')
    baseline={'PERIOD':'HP0120','CLIM':'AGERA5','SSP':'HIST'}
    with ThreadPoolExecutor(max_workers=4) as pool:
        climate_future=pool.submit(climate,field);elevation_future=pool.submit(elevation,field)
        temp_future=pool.submit(get_point,field,'RES01-TMP',baseline)
        rain_future=pool.submit(get_point,field,'RES01-PRC',baseline)
        nasa,e=climate_future.result(),elevation_future.result()
        t,r=temp_future.result(),rain_future.result()
    if (t.get('status')=='ok' and r.get('status')=='ok' and t.get('unit') in ('deg C','°C','C') and r.get('unit')=='mm'
            and finite(t.get('value')) and finite(r.get('value')) and r['value']>=0):
        c={'status':'ok','source':'FAO/IIASA GAEZ v5 / AgERA5','dataset_period':'2001–2020 historical climatology',
           'source_url':t['source_url'],'retrieved_at':t.get('retrieved_at'),'temperature_c':round(t['value'],2),
           'annual_rainfall_mm':round(r['value'],1),'resolution':'5 arc-minute regional grid (~9 km north–south)',
           'cell_center':t.get('cell_center'),'temperature_dataset':t,'rainfall_dataset':r,'fallback':False}
    else:
        c={**nasa,'fallback':True,'fallback_reason':'FAO climate pair unavailable. NASA POWER is a coarser alternative and may miss local terrain effects.'}
    soil={'status':'unknown','ph':None,'texture':None,'source':None,'dataset_period':None,
          'message':'No verified local soil pH or texture is available. Wetness, humidity and vegetation are not soil chemistry or fertility measurements.'}
    return {'status':'ok' if c['status']=='ok' else 'unavailable','pin':pin_id(field),
            'latitude':float(field.latitude),'longitude':float(field.longitude),'climate':c,'seasonal_climate':nasa,'terrain':e,'soil':soil,
            'temperature_c':c.get('temperature_c'),'annual_rainfall_mm':c.get('annual_rainfall_mm'),
            'elevation_m':e.get('elevation_m'),'ph':None,'texture':None}
