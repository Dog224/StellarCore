"""Read-only market reference import. Never changes agronomic crop requirements."""
import csv
import hashlib
import io
import json
import re
from functools import lru_cache
from pathlib import Path

SHEET_ID = '1fOM7QX1rh8FHpGnD7YNbH_k74JD6rbbWsnAP1tAkvj4'
SHEET_GID = '416596500'
SOURCE_URL = f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit?gid={SHEET_GID}'
CSV_URL = f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={SHEET_GID}'
DIRECTORY = Path(__file__).parent / 'data'
COUNTRIES = ['Laos', 'Thailand', 'Myanmar', 'Vietnam', 'Cambodia']
GROUPS = ['Leafy vegetables', 'Fruit vegetables', 'Root & bulb vegetables', 'Flower vegetables', 'Stem & shoot vegetables']
# Exact product references only: banana blossom is not a banana-fruit price,
# and field corn is not sweet corn. Generic tomato retains the source's varieties.
PROFILE_PRODUCTS = {'cabbage':{'Cabbage'}, 'cassava':{'Cassava (raw)'}, 'chilli':{'Chili Pepper'},
                    'cucumber':{'Cucumber'}, 'maize':{'Field Corn / Maize'},
                    'tomato':{'Cherry Tomato','Beefsteak / Large Tomato','Plum / Roma Tomato'}}


def numeric_range(text):
    match = re.fullmatch(r'\s*([\d,]+(?:\.\d+)?)\s*[-–]\s*([\d,]+(?:\.\d+)?)\s*', text)
    if not match:
        return None
    low, high = (float(value.replace(',', '')) for value in match.groups())
    return [low, high] if 0 <= low <= high else None


def parse_sheet(content):
    rows = list(csv.reader(io.StringIO(content.decode('utf-8-sig'))))
    if len(rows) < 4 or any(len(row) != 12 for row in rows):
        raise ValueError('The market sheet must have 12 columns and its source headers.')
    crops, groups, seen = [], [], set()
    group = None
    for index, row in enumerate(rows[3:], 4):
        if not any(cell.strip() for cell in row):
            continue
        if not row[0].strip().isdigit():
            if re.match(r'^\d+\.', row[0]):
                if len(groups) >= len(GROUPS):
                    raise ValueError('Unrecognized crop group. Review the changed source sheet.')
                group = {'id': str(len(groups)+1), 'name': GROUPS[len(groups)], 'name_lo': row[3] or row[0].split('(',1)[0].split('.',1)[-1].strip(), 'source_heading': row[0]}
                groups.append(group)
            continue
        source_id = row[0].strip()
        if not group or source_id in seen or not row[1].strip() or not row[2].strip():
            raise ValueError('Missing crop name, group, or duplicate source crop ID.')
        seen.add(source_id)
        entry = {'id': source_id, 'source_id': source_id, 'source_row': index,
                 'name': row[2].strip(), 'name_lo': row[1].strip(), 'group': group['id'],
                 'group_name': group['name'], 'group_name_lo': row[3], 'duration_raw': row[4],
                 'seasons': dict(zip(COUNTRIES, row[5:10])),
                 'source_url': SOURCE_URL + f'&range=A{index}:L{index}',
                 'raw_row': row, 'price_notes': [], 'unit': 'kg'}
        if source_id == '47' and row[2].strip() == 'Cassava / Sweet Potato':
            # Row 53 explicitly labels two different products. Match the labels,
            # not the order in the English combined name or the first number.
            for key, name, lao in [('cassava','Cassava (raw)','ມັນຕົ້ນ'), ('sweet-potato','Sweet potato','ມັນດ້າງ')]:
                def labelled(text):
                    return next((part.split('(',1)[0].strip() for part in text.split('/') if lao in part), '')
                local = numeric_range(labelled(row[10]))
                world = numeric_range(labelled(row[11]))
                duration_text = labelled(row[4])
                duration_values = re.match(r'^(\d+)\s*-\s*(\d+)', duration_text)
                if local is None or not duration_values:
                    raise ValueError('The combined cassava/sweet-potato row changed; review its product labels.')
                crops.append({**entry, 'id': source_id+'-'+key, 'name': name, 'name_lo': lao,
                    'growing_days': [int(value) for value in duration_values.groups()],
                    'laos_price': local, 'world_price': world,
                    'price_notes': ['Separated from the combined cassava / sweet potato source row.'] +
                        ([] if world else ['The sheet provides no world-reference price for raw cassava.'])})
            continue
        local, world = numeric_range(row[10]), numeric_range(row[11])
        duration_match = re.match(r'^(\d+)\s*-\s*(\d+)', row[4].strip())
        crops.append({**entry, 'laos_price': local, 'world_price': world,
                      'growing_days': [int(value) for value in duration_match.groups()] if duration_match else None,
                      'price_notes': [] if local and world else ['A price cell could not be interpreted; its original text is preserved.']})
    if not crops or len(groups) != 5:
        raise ValueError('Incomplete market catalogue.')
    return {'title_lo': rows[0][0], 'note_lo': rows[1][0], 'headers_lo': rows[2],
            'groups': groups, 'crops': crops, 'source_rows': len(seen), 'product_count': len(crops)}


@lru_cache(maxsize=2)
def _load(version):
    content = (DIRECTORY / 'market_source.csv').read_bytes()
    metadata = json.loads((DIRECTORY / 'market_source.json').read_text(encoding='utf-8'))
    if hashlib.sha256(content).hexdigest() != metadata['sha256']:
        raise ValueError('Market snapshot checksum mismatch.')
    return {**parse_sheet(content), 'source': metadata, 'status': 'ok'}


def catalogue():
    files = [DIRECTORY/'market_source.csv', DIRECTORY/'market_source.json']
    return _load(tuple((file.stat().st_mtime_ns, file.stat().st_size) for file in files))


def reference_for_crop(slug):
    try:
        data = catalogue()
    except (OSError, ValueError, KeyError):
        return {'status':'unavailable','entries':[],'source_url':SOURCE_URL,'unit':'kg'}
    names = PROFILE_PRODUCTS.get(slug, set())
    entries = [{key:crop[key] for key in ('id','name','name_lo','laos_price','world_price','source_url','source_row','price_notes')}
               for crop in data['crops'] if crop['name'] in names]
    return {'status': 'matched' if entries else 'not_in_sheet', 'entries': entries,
            'source_url': SOURCE_URL, 'source_year': data['source']['reference_year'],
            'unit': 'kg', 'scope': 'Spreadsheet reference ranges; not live buying prices.'}
