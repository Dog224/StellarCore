"""Bundle five Natural Earth country geometries; no runtime boundary API needed."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson'
COUNTRIES = {'MMR': 'Myanmar', 'LAO': 'Laos', 'THA': 'Thailand', 'KHM': 'Cambodia', 'VNM': 'Vietnam'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--retrieved-on', required=True, help='YYYY-MM-DD retrieval date')
    args = parser.parse_args()
    with urlopen(Request(SOURCE, headers={'User-Agent': 'TerraGrow boundary preparation'}), timeout=45) as response:
        raw = response.read(8_000_001)
    if len(raw) > 8_000_000:
        raise ValueError('Boundary source exceeds preparation size limit')
    features = []
    for feature in json.loads(raw)['features']:
        code = feature['properties']['ADM0_A3']
        if code not in COUNTRIES:
            continue
        geometry = feature['geometry']
        polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
        points = [point for polygon in polygons for ring in polygon for point in ring]
        bbox = [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]
        features.append({'type': 'Feature', 'properties': {'code': code, 'name': COUNTRIES[code]}, 'bbox': bbox, 'geometry': geometry})
    assert {f['properties']['code'] for f in features} == set(COUNTRIES)
    region = {
        'type': 'FeatureCollection', 'features': sorted(features, key=lambda f: f['properties']['code']),
        'source': {'name': 'Natural Earth Admin 0 countries, 1:50m', 'url': SOURCE,
                   'information_url': 'https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/',
                   'license': 'Public domain', 'license_url': 'https://www.naturalearthdata.com/about/terms-of-use/',
                   'retrieved_on': args.retrieved_on, 'sha256': hashlib.sha256(raw).hexdigest(),
                   'note': 'Generalized country borders for app coverage, not surveyed farm boundaries or the Mekong watershed.'},
    }
    region['bbox'] = [min(f['bbox'][0] for f in features), min(f['bbox'][1] for f in features),
                      max(f['bbox'][2] for f in features), max(f['bbox'][3] for f in features)]
    path = Path(__file__).resolve().parents[1] / 'website' / 'data' / 'mekong_region.geojson'
    path.write_text(json.dumps(region, separators=(',', ':')), encoding='utf-8')
    print(f'Bundled {len(features)} countries, {path.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
