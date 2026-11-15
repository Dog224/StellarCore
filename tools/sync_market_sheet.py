"""Import the user-supplied public sheet, preserving all original cells."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
import sys
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from website.market_data import CSV_URL, SOURCE_URL, DIRECTORY, parse_sheet

with urlopen(Request(CSV_URL, headers={'User-Agent':'MekongRise/1.0 market reference import'}), timeout=20) as response:
    content = response.read(2000001)
if len(content) > 2000000:
    raise SystemExit('Sheet export exceeds the import limit.')
data = parse_sheet(content)
year = re.search(r'\b20\d{2}\b', data['note_lo'])
if not year:
    raise SystemExit('The sheet does not state a reference year. Review before importing.')
metadata = {'source_url': SOURCE_URL, 'export_url': CSV_URL, 'gid': '416596500',
            'retrieved_at': datetime.now(timezone.utc).isoformat(), 'reference_year': int(year.group()),
            'survey_date': None, 'named_markets': None, 'independent_verification': False,
            'price_basis': 'Sheet-stated average wholesale/retail reference ranges per kilogram.',
            'local_currency': 'LAK', 'world_currency': 'USD', 'sha256': hashlib.sha256(content).hexdigest()}
DIRECTORY.mkdir(exist_ok=True)
(DIRECTORY/'market_source.csv').write_bytes(content)
(DIRECTORY/'market_source.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
print(f"Imported {data['source_rows']} source rows as {data['product_count']} products in {len(data['groups'])} groups.")
