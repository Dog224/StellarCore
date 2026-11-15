"""Transparent EcoCrop range screening, not an official FAO suitability model.

All active database profiles are scored with the same rules. No latitude bonuses,
popularity weights, example climates or fallback recommended crop are used.
"""
import calendar
import math
from datetime import date, timedelta
from django.utils import timezone
from .crop_environment import get_environment, finite, pin_id
from .models import CropProfile
from .crop_photos import photo_for
from .market_data import reference_for_crop

WEIGHTS={'temperature_c':40,'annual_rainfall_mm':35,'elevation_m':10,'ph':10,'texture':5}
METHOD={'version':'terragrow-ecocrop-screen-v1', 'weights':WEIGHTS,
        'name':'MekongRise transparent range screen; not an official FAO/GAEZ score',
        'rule':'Linear membership: 100 inside the published optimal range, tapering to 0 at absolute limits. Annual mean temperature and annual rainfall use FAO GAEZ climate normals where available, or an explicitly labelled NASA fallback. An altitude-only absolute ceiling is a binary constraint. Known absolute violations constrain the score to 0. Missing factors are excluded, never counted as matches. Both temperature and annual rainfall are required to rank. Thresholds and weights are transparent app choices, not FAO classifications.',
        'thresholds':{'higher':80,'moderate':60,'limited':40},
        'confidence_note':'A score describes match on available factors, not harvest success or confidence. Missing soil pH, texture and management prevent a verified field recommendation.'}


def membership(value, requirement):
    if not finite(value):return None,'missing_location_data'
    opt=requirement.get('optimal',[None,None]);absolute=requirement.get('absolute',[None,None])
    if not any(finite(v) for v in opt+absolute):return None,'missing_requirement'
    lo,hi=absolute;a,b=opt
    if (lo is not None and value<lo) or (hi is not None and value>hi):return 0,'outside_absolute'
    if a is None or b is None:return 100,'within_reported_absolute_limit'
    if a<=value<=b:return 100,'within_optimal'
    if value<a:
        if lo is None:return None,'missing_requirement'
        return (100*(value-lo)/(a-lo) if a>lo else 0),'below_optimal'
    if hi is None:return None,'missing_requirement'
    return (100*(hi-value)/(hi-b) if hi>b else 0),'above_optimal'


def duration(profile):
    water=profile.water
    if water.get('planning_growing_days'):
        return {'days':water['planning_growing_days'],'source_url':water['source_url'],'basis':'FAO irrigation training manual, approximate growing period',
                'ecocrop_cycle_days':profile.growing_days}
    return {'days':profile.growing_days,'source_url':profile.source['url'],'basis':'FAO ECOCROP species crop-cycle range',
            'ecocrop_cycle_days':profile.growing_days}


def planting_window(profile, environment, constrained, today):
    result={'status':'unknown','months':[],'next_start':None,'harvest_start':None,'harvest_end':None,
            'basis':'Estimated climatological planning window, not a verified Lao planting calendar or a rain forecast.',
            'method':'For each start month, use the midpoint of the sourced FAO growing-period guide. Require all monthly mean temperatures to be within absolute limits, average temperature membership at least 80/100, and gross rainfall over that period at least the lower FAO seasonal water guide. Effective rainfall, runoff, irrigation, rice flooding losses and varieties are not established.'}
    if constrained: return {**result,'reason':'outside_reference_range'}
    if profile.life_cycle=='perennial':return {**result,'reason':'perennial_establishment_unknown'}
    water=profile.water.get('seasonal_mm')
    period=profile.water.get('planning_growing_days')
    monthly=environment.get('seasonal_climate',environment.get('climate',{}))
    months=monthly.get('months',[])
    result.update(source_url=monthly.get('source_url'),dataset_period=monthly.get('dataset_period'),
                  uncertainty='Monthly NASA climate is coarser than the preferred annual GAEZ layers and can differ over mountains. Candidate windows require local confirmation.')
    if not water or not period:return {**result,'reason':'missing_seasonal_water_reference'}
    if len(months)!=12:return {**result,'reason':'missing_monthly_climate'}
    days=round(sum(period)/2)
    choices=[]
    for start in range(12):
        left=days;offset=0;rain=0;weighted_temp=0;temp_days=0;outside=False
        while left>0:
            month=months[(start+offset)%12];length=calendar.monthrange(2001,month['month'])[1]
            take=min(left,length)
            score,state=membership(month['temperature_c'],profile.requirements['temperature_c'])
            if score is None or state=='outside_absolute':outside=True;break
            weighted_temp+=score*take;temp_days+=take
            rain+=month['rainfall_mm']*take/length
            left-=take;offset+=1
        if not outside and temp_days and weighted_temp/temp_days>=80 and rain>=water[0]:choices.append(start+1)
    if not choices:return {**result,'status':'no_window','reason':'rainfed_window_not_identified'}
    dates=[date(today.year+(month<today.month or (month==today.month and today.day>1)),month,1) for month in choices]
    start=min(dates)
    return {**result,'status':'estimated','reason':'conditional_rainfed_window','months':choices,'next_start':start.isoformat(),
            'planning_duration_days':period,'harvest_start':(start+timedelta(days=period[0])).isoformat(),
            'harvest_end':(start+timedelta(days=period[1])).isoformat()}


def score_profile(profile, environment, today=None):
    today=today or timezone.localdate();checks=[];scores={};constraints=[]
    req=profile.requirements
    for key in WEIGHTS:
        requirement=req.get(key,{})
        actual=environment.get(key)
        if key=='texture':
            accepted=set(requirement.get('absolute',[]))|set(requirement.get('optimal',[]))
            if actual is None:score,state=None,'missing_location_data'
            elif not accepted:score,state=None,'missing_requirement'
            else:score,state=(100,'within_reported_absolute_limit') if actual in accepted else (0,'outside_absolute')
        else:
            score,state=membership(actual,requirement)
        if score is not None:scores[key]=max(0,min(100,score))
        if score is not None and score<=0:constraints.append(key)
        source=environment.get('climate',{}) if key in ('temperature_c','annual_rainfall_mm') else environment.get('terrain',{}) if key=='elevation_m' else environment.get('soil',{})
        checks.append({'factor':key,'reading':actual,'state':state,'score':round(score,1) if score is not None else None,
                       'weight':WEIGHTS[key],'optimal':requirement.get('optimal'),'absolute':requirement.get('absolute'),
                       'unit':requirement.get('unit'),'environment_source':source.get('source_url'),'requirement_source':profile.source['url']})
    can_rank=environment.get('climate',{}).get('status')=='ok' and all(key in scores for key in ('temperature_c','annual_rainfall_mm'))
    score=round(sum(scores[key]*WEIGHTS[key] for key in scores)/sum(WEIGHTS[key] for key in scores),1) if can_rank else None
    if can_rank and constraints:score=0
    level='unknown' if score is None else 'outside_range' if constraints else 'higher' if score>=80 else 'moderate' if score>=60 else 'limited' if score>=40 else 'low'
    missing=[check['factor'] for check in checks if check['score'] is None]
    seasonal=planting_window(profile,environment,bool(constraints) or not can_rank,today)
    return {'id':profile.slug,'name':profile.name,'scientific_name':profile.scientific_name,'category':profile.category,
            'image_url':'/static/'+profile.image_path,
            'image_kind':'Reference crop photograph, not a photo of your field' if photo_for(profile) else 'Crop illustration, not a photo of your field',
            'image_credit':photo_for(profile),
            'market_reference':reference_for_crop(profile.slug),
            'score':score,'level':level,'checks':checks,'constraints':constraints,'missing_factors':missing,
            'assessed_factors':len(scores),'total_factors':len(WEIGHTS),'evidence':'partial' if missing else 'all_available_factors_checked',
            'requirements':profile.requirements,'water':profile.water,'duration':duration(profile),'season':seasonal,
            'perennial':profile.life_cycle=='perennial','first_harvest_days':profile.first_harvest_days,
            'source':profile.source,'reference_version':profile.reference_version,'notes':profile.notes,
            'gaez_available':bool(profile.gaez_code),
            'gaez_scope':'Rain-fed low-input lowland rice scenario' if profile.slug=='rice' else 'Coffee group, not a species-specific check' if 'coffee' in profile.slug else 'Additional regional model context'}


def recommend(field, environment=None, today=None):
    env=environment if environment is not None else get_environment(field)
    if env['status']=='needs_location':return {'status':'needs_location','crops':[],'recommendations':[],'environment':env,'method':METHOD}
    crops=[score_profile(profile,env,today) for profile in CropProfile.objects.filter(active=True)]
    crops.sort(key=lambda crop:(crop['score'] is None,-(crop['score'] or 0),crop['name']))
    for crop in crops:
        crop['rank']=None if crop['score'] is None else 1+sum(other['score'] is not None and other['score']>crop['score'] for other in crops)
    candidates=[crop['id'] for crop in crops if crop['score'] is not None and crop['score']>=60 and not crop['constraints']][:3]
    return {'status':'ok' if env['status']=='ok' else 'unavailable','environment':env,'pin':env.get('pin'),
            'evaluated_at':timezone.now().isoformat(),'method':METHOD,'crops':crops,'recommendations':candidates,
            'limitations':['Estimated environmental match, not verified local agricultural advice.',
                           'No direct satellite measurement of soil fertility is used. Soil chemistry and field management require local checks.',
                           'Species ranges do not establish cultivar performance. Annual rainfall is not available irrigation water.',
                           'Nearby pins can share climate-grid values. Rankings are allowed to remain equal when evidence is equal.',
                           'Scores are not harvest probabilities. Harvest success is not guaranteed.']}
