"""Download explicitly curated Commons photographs and retain reuse metadata.

No image search or API calls run when the app serves a page. The JPEG thumbnails
are downloaded unchanged; only their display framing is set in CSS.
"""
import hashlib
import html
import json
import re
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
FILES = {
    'rice': 'Oryza sativa L.jpg',
    'maize': 'Corn field in my village.jpg',
    'cassava': 'Manihot esculenta, the Cassava plant (17254469394).jpg',
    'arabica-coffee': 'Bourbon Coffee.jpg',
    'robusta-coffee': 'Coffea canephora berries.JPG',
    'banana': 'Musa acuminata 375421070.jpg',
    'peanut': 'Arachis hypogaea 001.JPG',
    'soybean': 'Glycine max plant1 Carol Rose (10220578213).jpg',
    'mung-bean': '09042jfVigna radiata plantations Baliuag Philippines Monngo mungofvf 01.jpg',
    'tomato': '20140629Solanum lycopersicum2.jpg',
    'cabbage': 'Brassica oleracea 2011 G1.jpg',
    'cucumber': 'Cucumis sativus.jpg',
    'chilli': 'Capsicum annuum 3 - Kew.jpg',
}


def read(url, limit):
    with urlopen(Request(url, headers={'User-Agent': 'TerraGrow/1.0 local crop photo attribution'}), timeout=30) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Photo source exceeds download size limit')
    return data


def plain(value):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', '', value)).split())


def main():
    args = {'action': 'query', 'format': 'json', 'titles': '|'.join('File:' + value for value in FILES.values()),
            'prop': 'imageinfo', 'iiprop': 'url|extmetadata', 'iiurlwidth': 480}
    data = json.loads(read('https://commons.wikimedia.org/w/api.php?' + urlencode(args), 2_000_000))
    pages = {page['title']: page for page in data['query']['pages'].values()}
    for filename in FILES.values():
        if not pages.get('File:' + filename, {}).get('imageinfo'):
            raise ValueError(f'Photograph not found: {filename}')
    manifest = {}
    for slug, filename in FILES.items():
        info = pages['File:' + filename]['imageinfo'][0]
        meta = info['extmetadata']
        license_name = meta['LicenseShortName']['value']
        if not license_name.startswith(('CC BY', 'CC0', 'Public domain')):
            raise ValueError(f'Unsupported license for {filename}: {license_name}')
        path = ROOT / 'website' / 'static' / 'website' / 'crops' / (slug + '.jpg')
        download = info.get('thumburl', info['url'])
        photo = read(download, 1_000_000)
        if photo[:2] != b'\xff\xd8':
            raise ValueError(f'Expected JPEG for {filename}')
        path.write_bytes(photo)
        manifest[slug] = {
            'path': f'website/crops/{slug}.jpg', 'title': filename,
            'author': plain(meta.get('Artist', {}).get('value', 'Unknown photographer')),
            'source_url': info['descriptionurl'], 'download_url': download,
            'license': license_name, 'license_url': meta.get('LicenseUrl', {}).get('value') or 'https://commons.wikimedia.org/wiki/Commons:Public_domain',
            'description': plain(meta.get('ImageDescription', {}).get('value', '')),
            'taken_on': plain(meta.get('DateTimeOriginal', {}).get('value', '')),
            'retrieved_on': '2026-11-15', 'sha256': hashlib.sha256(photo).hexdigest(),
            'bytes': len(photo), 'width': info.get('thumbwidth', info.get('width')),
            'height': info.get('thumbheight', info.get('height')),
            'changes': 'Unchanged Wikimedia JPEG thumbnail; cropped for display with CSS.',
            'framing': {'cassava':'50% 32%', 'peanut':'50% 35%', 'soybean':'50% 30%',
                        'rice':'50% 65%', 'banana':'60% 45%'}.get(slug, '50% 50%'),
        }
        print(f'{slug}: {len(photo):,} bytes; {license_name}')
    target = ROOT / 'website' / 'data' / 'crop_photos.json'
    target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    credits = ['# Crop photograph credits', '',
               'These are reference photographs of crops, not observations of a selected farm. JPEG thumbnails are unchanged; their framing on the page uses CSS cropping.', '',
               '| Crop file | Photographer | License | Original photograph |', '|---|---|---|---|']
    for slug, photo in manifest.items():
        credits.append(f"| {slug}.jpg | {photo['author']} | [{photo['license']}]({photo['license_url']}) | [{photo['title']}]({photo['source_url']}) |")
    (ROOT / 'website/static/website/crops/PHOTO-CREDITS.md').write_text('\n'.join(credits) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
