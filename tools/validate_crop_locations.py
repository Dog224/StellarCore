"""Read-only live validation: three contrasting Laos locations, no farm changes."""
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from datetime import datetime,timezone

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
os.environ.setdefault('DJANGO_SETTINGS_MODULE','stellas.settings')
import django
django.setup()
from website.crop_recommendations import recommend

POINTS=[('Vientiane lowlands',18.0,102.6),('Paksong, Bolaven Plateau',15.18,106.23),('Phongsaly highlands',21.68,102.10)]
reports=[]
for name,latitude,longitude in POINTS:
    report=recommend(SimpleNamespace(latitude=latitude,longitude=longitude,next_crop=''))
    if report['status']!='ok':raise RuntimeError(f'Live environmental data unavailable for {name}; no fixture was substituted')
    if report['environment']['climate'].get('fallback'):raise RuntimeError(f'Preferred FAO source unavailable at {name}; retry before comparing source periods')
    reports.append({'location_name':name,**report})
    print(json.dumps({'location':name,'temperature_c':report['environment']['temperature_c'],
                      'annual_rainfall_mm':report['environment']['annual_rainfall_mm'],'elevation_m':report['environment']['elevation_m'],
                      'top3':[(crop['name'],crop['score']) for crop in report['crops'][:3]]}),flush=True)
environments={(r['environment']['temperature_c'],r['environment']['annual_rainfall_mm'],r['environment']['elevation_m']) for r in reports}
rankings={tuple(c['id'] for c in report['crops'][:3]) for report in reports}
if len(environments)!=3 or len(rankings)!=3:raise RuntimeError('Distinct environmental values and top-three rankings were not demonstrated for all three locations')
output=ROOT/'reports';output.mkdir(exist_ok=True)
data={'validated_at':datetime.now(timezone.utc).isoformat(),'method':'Actual FAO GAEZ, NASA POWER and SRTM responses; no environment fixtures; no database writes.',
      'checks':{'distinct_environments':len(environments),'distinct_top_three_rankings':len(rankings),'location_count':3},'reports':reports}
path=output/'crop-location-validation.json';path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
lines=['# Live Laos crop-location validation','',data['validated_at'],'',data['method'],'',
       '| Location | Annual mean °C | Annual rain mm | Elevation m | Top three estimated matches |','|---|---:|---:|---:|---|']
for report in reports:
    e=report['environment'];top=', '.join(f'{c["name"]} ({c["score"]}/100)' for c in report['crops'][:3])
    lines.append(f'| {report["location_name"]} | {e["temperature_c"]} | {e["annual_rainfall_mm"]} | {e["elevation_m"]} | {top} |')
lines+=['','All three use FAO GAEZ / AgERA5 2001–2020 annual climate. Terrain is SRTM v3 (~90 m, February 2000). NASA monthly climate is a separately dated planning input; it is not mixed into the annual score.',
        '','Soil pH and texture are unknown at all three test points and are excluded from the score. Scores are partial environmental matches, not verified local advice or harvest probabilities. See the JSON for full per-factor requirements, source URLs, retrieval dates, missing data, and all 13 ranked crops.']
(output/'crop-location-validation.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
print('PASS: 3 distinct live environments and 3 distinct top-three rankings. Reports written to reports/.')
