"""Rebuild a reviewable, versioned crop catalogue from official FAO sheets.

No runtime scraping or network migration. Raw sheets are cached for audit; no
missing numeric limit is filled in. Annual rain and seasonal ET remain distinct.
"""
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.crop_source_cache'
WATER_URL = 'https://www.fao.org/4/s2022e/s2022e02.htm'
# Catalogue membership is not a recommendation or a ranking. Coffee species and
# vegetable species retain their own requirements instead of a generic profile.
SPECIES = [
    ('rice', 'Rice', 'Oryza sativa', 1574, 'cereal', 'RCW', 'RICW'),
    ('maize', 'Maize', 'Zea mays', 2175, 'cereal', 'MZE', 'MAIZ'),
    ('cassava', 'Cassava', 'Manihot esculenta', 1420, 'root', 'CSV', 'CASV'),
    ('arabica-coffee', 'Arabica coffee', 'Coffea arabica', 749, 'perennial', 'COF', 'COFF'),
    ('robusta-coffee', 'Robusta coffee', 'Coffea canephora', 750, 'perennial', 'COF', 'COFF'),
    ('banana', 'Banana', 'Musa acuminata', 7848, 'perennial', 'BAN', 'BANA'),
    ('peanut', 'Peanut', 'Arachis hypogaea', 2199, 'legume', 'GRD', 'GRND'),
    ('soybean', 'Soybean', 'Glycine max', 1150, 'legume', 'SOY', 'SOYB'),
    ('mung-bean', 'Mung bean', 'Vigna radiata', 2150, 'legume', None, None),
    ('tomato', 'Tomato', 'Lycopersicon esculentum', 1379, 'vegetable', 'TOM', 'TOMA'),
    ('cabbage', 'Cabbage', 'Brassica oleracea var. capitata', 554, 'vegetable', 'CAB', 'CABB'),
    ('cucumber', 'Cucumber', 'Cucumis sativus', 817, 'vegetable', None, None),
    ('chilli', 'Chilli pepper', 'Capsicum annuum', 618, 'vegetable', None, None),
]


class Rows(HTMLParser):
    def __init__(self):
        super().__init__(); self.rows=[]; self.row=None; self.cell=None
    def handle_starttag(self, tag, attrs):
        if tag == 'tr': self.row=[]
        if tag in ('td', 'th'): self.cell=[]
    def handle_data(self, value):
        if self.cell is not None: self.cell.append(value)
    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            if self.row is not None: self.row.append(' '.join(' '.join(self.cell).split()))
            self.cell=None
        if tag == 'tr' and self.row is not None: self.rows.append(self.row); self.row=None


def fetch(name, url):
    path = CACHE / (name + '.html')
    if '--cached' not in sys.argv or not path.exists():
        with urlopen(Request(url, headers={'User-Agent': 'TerraGrow crop-reference audit'}), timeout=20) as response:
            path.write_bytes(response.read(2_000_000))
    raw = path.read_bytes()
    rows=Rows(); rows.feed(raw.decode('utf8', errors='replace'))
    return rows.rows, hashlib.sha256(raw).hexdigest()


def number(value):
    return float(value) if re.fullmatch(r'-?\d+(?:\.\d+)?', value or '') else None


def main():
    CACHE.mkdir(exist_ok=True)
    water_rows, water_hash = fetch('fao-seasonal-water', WATER_URL)
    water={}; durations={}
    for row in water_rows:
        if len(row) == 2 and re.fullmatch(r'\d+\s*[-–]\s*\d+', row[1]):
            water[row[0].lower()] = [int(n) for n in re.split(r'\s*[-–]\s*', row[1])]
        if len(row)==4:
            for offset in (0,2):
                if re.fullmatch(r'\d+\s*[-–]\s*\d+',row[offset+1]):
                    durations[row[offset].lower()]=[int(n) for n in re.split(r'\s*[-–]\s*',row[offset+1])]
    aliases={'rice':'rice (paddy)', 'peanut':'peanut', 'chilli':'pepper'}
    verified=datetime.now(timezone.utc).date().isoformat()
    def profile(item):
        slug,name,scientific,identifier,category,gaez,potential=item
        url=f'https://ecocrop.apps.fao.org/ecocrop/srv/en/dataSheet?id={identifier}'
        rows, digest=fetch(str(identifier), url)
        by_label={row[0]:row for row in rows if row}
        req={}
        for key,label,unit in [('temperature_c','Temperat. requir.','°C'),('annual_rainfall_mm','Rainfall (annual)','mm/year'),
                               ('ph','Soil PH','pH'),('elevation_m','Altitude','m')]:
            values=by_label[label][1:5]
            req[key]={'optimal':[number(v) for v in values[:2]],'absolute':[number(v) for v in values[2:]],'unit':unit}
        textures=by_label['Temperat. requir.'][6:8]
        req['texture']={'optimal':textures[0].split(', ') if textures[0] else [],'absolute':textures[1].split(', ') if textures[1] else []}
        req['drainage']={'optimal':by_label['Soil PH'][6] or None,'absolute':by_label['Soil PH'][7] or None}
        cycle=by_label.get('Product. system', [])
        duration=[number(v) for v in cycle[3:5]] if len(cycle)>=5 else [None,None]
        duration=[v if v and v>0 else None for v in duration]
        # A coffee fruit cycle does not describe establishment-to-first-harvest.
        life='perennial' if category=='perennial' else 'annual crop use'
        et=water.get(aliases.get(slug, slug))
        planning_days=durations.get({'maize':'maize grain','peanut':'peanut/groundnut','chilli':'pepper'}.get(slug,slug))
        notes=[]
        if slug=='rice': notes.append('EcoCrop requirements describe Oryza sativa broadly. The separate GAEZ check is explicitly a rain-fed lowland-rice scenario, not inferred field management.')
        if 'coffee' in slug: notes.append('GAEZ coffee is a crop group and does not distinguish Arabica and Robusta; use its result only as additional regional context.')
        if slug=='banana': notes.append('EcoCrop record is Musa acuminata; requirements can differ for other banana species and cultivars.')
        return {'slug':slug,'name':name,'scientific_name':scientific,'category':category,'life_cycle':life,
                'requirements':req,'growing_days':duration,'first_harvest_days':None if life=='perennial' else duration,
                'water':{'seasonal_mm':et,'planning_growing_days':planning_days,'basis':'FAO training manual Tables 4 and 5: approximate growing period and crop evapotranspiration; not irrigation volume or annual rainfall.',
                         'source_url':WATER_URL if et else None,'source_date':None,'retrieved_on':verified if et else None},
                'image_path':f'website/crops/{slug}.jpg','gaez_code':gaez,'gaez_potential_code':potential,'notes':notes,
                'source':{'name':'FAO ECOCROP','record_id':identifier,'url':url,'publication_date':None,'retrieved_on':verified,
                          'raw_sha256':digest,'database_note':'Historical FAO ECOCROP database, discontinued around 2015; source sheet is undated.'}}
    with ThreadPoolExecutor(max_workers=3) as pool: profiles=list(pool.map(profile, SPECIES))
    for crop in profiles:
        for key in ('temperature_c','annual_rainfall_mm','ph'):
            v=crop['requirements'][key]
            if any(n is None for n in v['optimal']+v['absolute']):raise ValueError(f'Missing core reference for {crop["slug"]}: {key}')
    output={'version':'ecocrop-laos-v1','retrieved_on':verified,'fao_water_source_sha256':water_hash,'crops':profiles}
    (ROOT/'website/data/crops_ecocrop_v1.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    for crop in profiles: print(crop['slug'], crop['growing_days'], crop['water']['seasonal_mm'], crop['requirements']['temperature_c'])


if __name__=='__main__': main()
