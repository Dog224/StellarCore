"""Refresh the bundled GAEZ v5 catalogue from FAO's public metadata."""
import json
import re
import time
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://data.fao.org/catalog/api/3/action/package_search?q=%22GAEZ-V5%22&rows=500'
THEMES = {1: 'Land and Water Resources', 2: 'Agro-climatic Resources', 3: 'Agro-climatic Potential Yield',
          4: 'Suitability and Attainable Yield', 5: 'Actual Yields and Production', 6: 'Yield and Production Gaps'}


def get_json(url):
    with urlopen(Request(url, headers={'User-Agent': 'Mozilla/5.0 (TerraGrow metadata sync)'}), timeout=15) as response:
        return json.load(response)


def build(item):
    notes = item.get('notes', '')
    match = re.search(r'Map code\s*:\s*([^\s]+)', notes)
    if not match: return None
    code = match[1]
    if code.endswith('-TS'): return None  # Year-by-year layers are outside this baseline explorer.
    theme = next((n for prefix, n in [('RES01-', 2), ('RES02-', 3), ('RES05-', 4), ('RES06-', 5), ('RES07-', 6)] if code.startswith(prefix)), 1)
    resources = item.get('resources', [])
    config_url = next((r['url'] for r in resources if r.get('name') == code and r.get('url', '').endswith('.json')), None)
    if not config_url: return None
    config_url = config_url.replace('https://data.apps.fao.org/', 'https://data.fao.org/')
    try:
        config = get_json(config_url)
        dimensions = []
        defaults = config.get('extension', {}).get('default', {})
        for dimension in config.get('id', []):
            info = config['dimension'][dimension]
            labels = info['category']['label']
            dimensions.append({'code': dimension, 'label': info.get('label', dimension),
                               'options': labels, 'default': defaults.get(dimension)})
        def text(pattern, fallback=''):
            found = re.search(pattern, notes)
            return found[1].strip() if found else fallback
        scale = text(r'Scale Factor\s*:\s*([^\s]+)', '1')
        nodata = text(r'No data value\s*:[ \t]*([^\r\n]*)')
        storage = next((r['url'] for r in resources if 'storage.googleapis.com' in r.get('url', '') and '.tif' in r['url']), None)
        style_url = next((r.get('url', '') for r in resources if '/styles/' in r.get('url', '')), '')
        style_code = style_url.split('/styles/')[-1].split('/')[0] if style_url else None
        classes = {}
        if style_code and text(r'Unit\s*:[ \t]*([^\r\n]+)').lower() == 'class':
            try:
                style = get_json(f'https://storage.googleapis.com/fao-gismgr-gaez-v5-data/DATA/GAEZ-V5/STYLE/GAEZ-V5.{style_code}.json')
                if style.get('colorMap', {}).get('type') == 'VALUES':
                    classes = {format(item['quantity'], 'g'): item['label'] for item in style['colorMap']['items']}
            except Exception:
                pass  # Raw class codes remain available if the legend is unavailable.
        title = re.split(r'\s*\(Global|\s+- GAEZ', item['title'], maxsplit=1, flags=re.IGNORECASE)[0].strip()
        return {'id': code, 'theme': theme, 'title': title,
                'unit': text(r'Unit\s*:[ \t]*([^\r\n]+)'), 'scale': float(scale),
                'nodata': float(nodata) if nodata and re.fullmatch(r'-?[\d.]+', nodata) else None,
                'publication': text(r'\*\*Data publication:\*\*\s*([^\s]+)'),
                'source_url': 'https://data.fao.org/catalog/dataset/' + item['name'],
                'config_url': config_url, 'dimensions': dimensions,
                'description': ' '.join(notes.split('**Data publication:')[0].split())[:1800],
                'kind': 'mapset' if dimensions else 'map', 'download_url': storage,
                'classes': classes, 'style_code': style_code,
                'license': 'CC BY 4.0', 'credit': 'FAO and IIASA, GAEZ v5'}
    except Exception as error:
        print('Skipped', code, str(error), flush=True)
        return None


if __name__ == '__main__':
    saved = ROOT / '.gaez_cache/fao_catalog.json'
    data = json.loads(saved.read_text(encoding='utf-8')) if '--use-cache' in sys.argv and saved.exists() else get_json(SOURCE)
    saved.parent.mkdir(exist_ok=True)
    saved.write_text(json.dumps(data), encoding='utf-8')
    with ThreadPoolExecutor(max_workers=4) as pool:
        layers = [layer for layer in pool.map(build, data['result']['results']) if layer]
    layers.sort(key=lambda layer: (layer['theme'], layer['title']))
    counts = {n: sum(layer['theme'] == n for layer in layers) for n in THEMES}
    if any(count == 0 for count in counts.values()): raise RuntimeError(f'Incomplete theme catalogue: {counts}')
    destination = ROOT / 'website/data/gaez_catalog.json'
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps({'version': 'GAEZ v5', 'retrieved': time.strftime('%Y-%m-%d'),
                                      'source': SOURCE, 'themes': THEMES, 'layers': layers}, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Saved', len(layers), 'layers', counts, flush=True)
